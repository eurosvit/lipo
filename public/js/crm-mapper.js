// ============================================================
// LipoLand — CRM SKU Mapper module
// ============================================================
// Модалка ручної прив'язки SKU з CRM до товарів каталогу.
// Працює разом з autoMatchCrmSku (мульти-тірне співпадіння).
// Глобали: getDB, saveDB, esc, fmt, openModal, closeModal, renderPage,
// uploadInvoice (не тут), window._crmSkuMapDraft на window для inline-handlers.

(function(){
  'use strict';

  // ===== CRM SKU mapper =====
  window._crmSkuMapDraft = {}; // { crmSku: productId }
  
  // Спроба автоматично знайти товар у каталозі за CRM SKU + назвою
  // (та сама логіка що й при синку SalesDrive). Якщо передано crmName —
  // додатково пробуємо знайти SKU всередині назви та співпадіння по назві.
  function autoMatchCrmSku(db, crmSku, crmName) {
    if (!crmSku && !crmName) return null;
    var sku = String(crmSku||'').replace(/_mamulya$/i,'').replace(/-Boy$/i,'').replace(/-Girl$/i,'').trim();
    // 1) SKU bidirectional prefix
    if (sku || crmSku) {
      var match = db.products.find(function(p){
        if (!p.sku) return false;
        return p.sku === sku || p.sku === crmSku
            || (sku && sku.indexOf(p.sku) === 0) || (sku && p.sku.indexOf(sku) === 0);
      });
      if (match) return match.id;
    }
    if (crmName) {
      var crmNameLower = String(crmName).toLowerCase().trim();
      // 2) Tokenize CRM name → each token as exact SKU (longest first)
      var tokens = crmNameLower.split(/[\s\-_,;()\/]+/).filter(function(t){ return t.length >= 3; });
      tokens.sort(function(a,b){ return b.length - a.length; });
      for (var ti = 0; ti < tokens.length; ti++) {
        var tok = tokens[ti];
        var m = db.products.find(function(p){ return p.sku && p.sku.toLowerCase() === tok; });
        if (m) return m.id;
      }
      // 3) Exact name match (with optional leading-SKU-token strip)
      var stripped = crmNameLower.replace(/^\S+\s+/, '');
      var mn = db.products.find(function(p){
        if (!p.name) return false;
        var pn = p.name.toLowerCase().trim();
        return pn === crmNameLower || pn === stripped;
      });
      if (mn) return mn.id;
      // 4) Our product name as substring of CRM name (≥6 chars, longest first)
      var candidates = db.products.filter(function(p){ return p.name && p.name.length >= 6; });
      candidates.sort(function(a,b){ return (b.name||'').length - (a.name||'').length; });
      var ms = candidates.find(function(p){
        return crmNameLower.indexOf(p.name.toLowerCase().trim()) !== -1;
      });
      if (ms) return ms.id;
    }
    return null;
  }
  
  function openCrmSkuMapper() {
    var db = getDB();
    if (!db.crmSkuMap) db.crmSkuMap = {};
    // Збираємо всі унікальні CRM-SKU з замовлень (привʼязані і ні)
    var skuStats = {}; // sku -> { sku, sampleName, count, productId, sampleOrderNum }
    (db.orders||[]).forEach(function(o){
      (o.items||[]).forEach(function(it){
        if (!it.sku) return;
        var key = it.sku;
        if (!skuStats[key]) {
          // Пріоритет: вже в замовленні → ручний мапінг → автоматичний матч проти каталогу
          var pid = it.productId || db.crmSkuMap[key] || autoMatchCrmSku(db, key, it.name);
          skuStats[key] = { sku: key, sampleName: it.name||'', count: 0, productId: pid, sampleOrderNum: o.num };
        }
        skuStats[key].count++;
        if (!skuStats[key].productId && it.productId) skuStats[key].productId = it.productId;
      });
    });
    // Унікальні + сорт: ті, що без привʼязки — спочатку
    var list = Object.values(skuStats).sort(function(a,b){
      if (!a.productId && b.productId) return -1;
      if (a.productId && !b.productId) return 1;
      return b.count - a.count;
    });
    window._crmSkuMapDraft = {};
    list.forEach(function(s){ if (s.productId) window._crmSkuMapDraft[s.sku] = s.productId; });
    renderCrmSkuMapper(list);
    openModal('crm-sku-mapper');
  }
  
  function renderCrmSkuMapper(list) {
    var db = getDB();
    var prods = (db.products||[]).filter(function(p){ return p.active!==false; });
    var unlinkedCount = list.filter(function(s){ return !window._crmSkuMapDraft[s.sku]; }).length;
  
    var html = '<p style="font-size:13px;color:var(--text-light);margin-bottom:14px;">'+
      'Унікальних SKU з CRM: <strong>'+list.length+'</strong> • Не привʼязано: <strong style="color:'+(unlinkedCount?'#C62828':'#2E7D32')+';">'+unlinkedCount+'</strong>'+
      '<br>Обери для кожного CRM-SKU відповідник у твоєму каталозі. Привʼязка збережеться: всі минулі і майбутні замовлення з цим SKU автоматично знайдуть товар.</p>';
  
    html += '<div style="display:flex;gap:8px;margin-bottom:14px;flex-wrap:wrap;">'+
      '<button class="btn btn-primary btn-sm" onclick="rematchAllOrders()" title="Перевірити всі замовлення і привʼязати товари за поточними правилами матчингу">🔄 Перематчити всі замовлення</button>'+
      (unlinkedCount > 0 ? '<button class="btn btn-success btn-sm" onclick="bulkCreateUnlinked()">⚡ Створити ВСІ '+unlinkedCount+' у каталозі</button>' : '')+
      (unlinkedCount > 0 ? '<button class="btn btn-outline btn-sm" onclick="importProductsFromSalesDrive()" title="Підтягнути товари з SalesDrive (з SKU, назвою, ціною)">📥 Імпортувати з SalesDrive</button>' : '')+
    '</div>';
  
    list.forEach(function(s){
      var picked = window._crmSkuMapDraft[s.sku] || '';
      var unlinked = !picked;
      var opts = '<option value="">— не привʼязано —</option>' + prods.map(function(p){
        return '<option value="'+p.id+'" '+(p.id===picked?'selected':'')+'>'+
          (p.sku?p.sku+' — ':'')+esc(p.name)+
        '</option>';
      }).join('');
      var createBtn = unlinked ? '<button class="btn btn-success btn-sm" style="margin-top:6px;font-size:11px;padding:4px 10px;" onclick="quickCreateProductFromCrm(\''+esc(s.sku).replace(/'/g,"\\'")+'\',\''+esc(s.sampleName).replace(/'/g,"\\'")+'\')">+ Створити в каталозі</button>' : '';
      html += '<div style="border:1px solid '+(unlinked?'#FFCDD2':'#C8E6C9')+';border-radius:10px;padding:12px;margin-bottom:10px;background:'+(unlinked?'#FFF8F8':'#F1F8E9')+';">'+
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;align-items:start;">'+
          '<div>'+
            '<div style="font-size:11px;color:var(--text-light);margin-bottom:2px;">CRM SKU (з SalesDrive)</div>'+
            '<div><code style="font-size:13px;background:#fff;padding:2px 6px;border-radius:4px;">'+esc(s.sku)+'</code> <span style="font-size:11px;color:var(--text-light);">×'+s.count+' замовл.</span></div>'+
            '<div style="font-size:11px;color:var(--text-light);margin-top:4px;">Назва з CRM: <em>'+esc(s.sampleName.slice(0,80))+'</em></div>'+
            createBtn+
          '</div>'+
          '<div>'+
            '<div style="font-size:11px;color:var(--text-light);margin-bottom:2px;">Товар з твого каталогу</div>'+
            '<select onchange="window._crmSkuMapDraft[\''+esc(s.sku)+'\']=this.value;openCrmSkuMapperRefresh()">'+opts+'</select>'+
          '</div>'+
        '</div>'+
      '</div>';
    });
  
    if (!list.length) html = '<div style="text-align:center;padding:40px;color:var(--text-light);">У замовленнях ще немає товарів з CRM.</div>';
  
    document.getElementById('crm-sku-mapper-body').innerHTML = html;
  }
  
  function openCrmSkuMapperRefresh() {
    // Re-render without re-collecting (preserves user picks)
    var db = getDB();
    var skuStats = {};
    (db.orders||[]).forEach(function(o){
      (o.items||[]).forEach(function(it){
        if (!it.sku) return;
        if (!skuStats[it.sku]) skuStats[it.sku] = { sku: it.sku, sampleName: it.name||'', count: 0, productId: window._crmSkuMapDraft[it.sku] || null, sampleOrderNum: o.num };
        skuStats[it.sku].count++;
      });
    });
    var list = Object.values(skuStats).sort(function(a,b){
      var ap = !!window._crmSkuMapDraft[a.sku], bp = !!window._crmSkuMapDraft[b.sku];
      if (!ap && bp) return -1;
      if (ap && !bp) return 1;
      return b.count - a.count;
    });
    renderCrmSkuMapper(list);
  }
  
  function quickCreateProductFromCrm(sku, name) {
    var db = getDB();
    // Перевірка дублікату
    var existing = db.products.find(function(p){ return p.sku === sku; });
    if (existing) {
      window._crmSkuMapDraft[sku] = existing.id;
      openCrmSkuMapperRefresh();
      return;
    }
    if (!confirm('Створити в каталозі:\n\nSKU: '+sku+'\nНазва: '+name+'\n\n(Ціну, рецепт і ставку майстра задаси пізніше у 📦 Склад → редагування товара)')) return;
    var newP = {
      id: uid(),
      sku: sku,
      name: name || sku,
      category: '',
      size: '',
      sellPrice: 0,
      stock: 0,
      inProgress: 0,
      recipe: [],
      workerRate: null,
      active: true
    };
    db.products.push(newP);
    saveDB(db);
    window._crmSkuMapDraft[sku] = newP.id;
    openCrmSkuMapperRefresh();
  }
  
  function rematchAllOrders() {
    var db = getDB();
    if (!db.crmSkuMap) db.crmSkuMap = {};
    var linked = 0, alreadyLinked = 0, stillUnlinked = 0;
    var examplesUnlinked = [];
    (db.orders||[]).forEach(function(o){
      (o.items||[]).forEach(function(it){
        if (!it.sku) return;
        if (it.productId) { alreadyLinked++; return; }
        // 1) Ручна мапа
        var pid = db.crmSkuMap[it.sku];
        // 2) Автоматичний матч (по SKU + назві)
        if (!pid) pid = autoMatchCrmSku(db, it.sku, it.name);
        if (pid) {
          it.productId = pid;
          linked++;
        } else {
          stillUnlinked++;
          if (examplesUnlinked.indexOf(it.sku) === -1 && examplesUnlinked.length < 5) examplesUnlinked.push(it.sku);
        }
      });
    });
    saveDB(db);
    var msg = '🔄 Перематчинг завершено:\n\n'+
      '• Привʼязано тепер: '+linked+'\n'+
      '• Вже були привʼязані: '+alreadyLinked+'\n'+
      '• Все ще без товару: '+stillUnlinked;
    if (stillUnlinked > 0) {
      msg += '\n\nЦих SKU справді немає в каталозі (приклади): '+examplesUnlinked.join(', ');
    }
    alert(msg);
    openCrmSkuMapper();
  }
  
  function bulkCreateUnlinked() {
    var db = getDB();
    // Зібрати всі непривʼязані з замовлень
    var skus = {};
    (db.orders||[]).forEach(function(o){
      (o.items||[]).forEach(function(it){
        if (!it.sku) return;
        if (window._crmSkuMapDraft[it.sku]) return;
        // Забираємо ціну з замовлення для дефолту
        if (!skus[it.sku]) skus[it.sku] = { sku: it.sku, name: it.name||'', price: it.price||0 };
      });
    });
    var keys = Object.keys(skus);
    if (!keys.length) { alert('Немає непривʼязаних SKU'); return; }
    if (!confirm('Створити '+keys.length+' нових товарів у каталозі?\n\n(SKU, назва і ціна з CRM — рецептуру, ставку майстра і собівартість заповниш у 📦 Склад пізніше)')) return;
    var created = 0;
    keys.forEach(function(sku){
      var info = skus[sku];
      var existing = db.products.find(function(p){ return p.sku === sku; });
      if (existing) {
        window._crmSkuMapDraft[sku] = existing.id;
        return;
      }
      var newP = {
        id: uid(), sku: sku, name: info.name || sku, category:'', size:'',
        sellPrice: info.price || 0, stock: 0, inProgress: 0, recipe: [],
        workerRate: null, active: true
      };
      db.products.push(newP);
      window._crmSkuMapDraft[sku] = newP.id;
      created++;
    });
    saveDB(db);
    alert('✅ Створено '+created+' товарів. Натисни "Зберегти і привʼязати" щоб привʼязати замовлення.');
    openCrmSkuMapperRefresh();
  }
  
  function importProductsFromSalesDrive() {
    var db = getDB();
    var settings = {};
    try { settings = JSON.parse(localStorage.getItem('lipo_sd_settings')||'{}'); } catch(e){}
    if (!settings.domain || !settings.apiKey) {
      alert('Спочатку налаштуй CRM у ⚙️ Налаштування → CRM');
      return;
    }
    var statusEl = document.getElementById('crm-sku-mapper-body');
    var origHtml = statusEl.innerHTML;
    statusEl.innerHTML = '<div style="text-align:center;padding:40px;">Завантаження товарів з SalesDrive…</div>';
  
    fetch('/api/salesdrive/proxy', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ path: '/api/products/list/' })
    })
    .then(function(r){ return r.json(); })
    .then(function(data){
      var products = (data && data.data) || (data && data.products) || [];
      if (!Array.isArray(products) || !products.length) {
        alert('SalesDrive не повернув товарів. Перевір чи в CRM є товари.');
        openCrmSkuMapper();
        return;
      }
      var existingSkus = {};
      db.products.forEach(function(p){ if (p.sku) existingSkus[p.sku] = p; });
      var created = 0, skipped = 0;
      products.forEach(function(sp){
        var sku = sp.sku || sp.article || '';
        if (!sku) { skipped++; return; }
        if (existingSkus[sku]) { skipped++; return; }
        var newP = {
          id: uid(), sku: sku, name: sp.name || sp.title || sku,
          category: '', size: '',
          sellPrice: parseFloat(sp.price) || parseFloat(sp.priceUah) || 0,
          stock: 0, inProgress: 0, recipe: [],
          workerRate: null, active: true
        };
        db.products.push(newP);
        created++;
      });
      saveDB(db);
      alert('📥 Імпорт з SalesDrive:\n• Створено товарів: '+created+'\n• Пропущено (вже є): '+skipped);
      openCrmSkuMapper();
    })
    .catch(function(e){
      alert('Помилка імпорту: '+e.message);
      openCrmSkuMapper();
    });
  }
  
  function applyCrmSkuMap() {
    var db = getDB();
    if (!db.crmSkuMap) db.crmSkuMap = {};
    // Зберігаємо тільки реальні привʼязки
    Object.keys(window._crmSkuMapDraft).forEach(function(sku){
      if (window._crmSkuMapDraft[sku]) db.crmSkuMap[sku] = window._crmSkuMapDraft[sku];
      else delete db.crmSkuMap[sku];
    });
    // Перепривʼязуємо всі замовлення
    var linked = 0;
    (db.orders||[]).forEach(function(o){
      (o.items||[]).forEach(function(it){
        if (!it.sku) return;
        var pid = db.crmSkuMap[it.sku];
        if (pid && it.productId !== pid) {
          it.productId = pid;
          var p = db.products.find(function(x){ return x.id === pid; });
          if (p) {
            // Оновлюємо name/sku до каталогових (CRM-назва зберігається в it.crmName якщо треба)
            if (!it.crmName) it.crmName = it.name;
          }
          linked++;
        }
      });
    });
    saveDB(db);
    alert('✅ Збережено. Привʼязано позицій у замовленнях: '+linked);
    closeModal('crm-sku-mapper');
    renderPage('orders');
  }

  // window._crmSkuMapDraft має бути на window — inline-handlers звертаються до нього
  // як до глобалу (напр. onchange="window._crmSkuMapDraft[..]=this.value").
  // Експорт функцій:
  window.autoMatchCrmSku = autoMatchCrmSku;
  window.openCrmSkuMapper = openCrmSkuMapper;
  window.openCrmSkuMapperRefresh = openCrmSkuMapperRefresh;
  window.importProductsFromSalesDrive = importProductsFromSalesDrive;
  window.applyCrmSkuMap = applyCrmSkuMap;
})();
