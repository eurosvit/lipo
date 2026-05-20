// ============================================================
// LipoLand — Production module
// ============================================================
// Виробництво: запуск партій, списання матеріалів (worker→main),
// здача на склад/фулфілмент, моментальне виготовлення/в борг,
// undo-тости, FIFO-таблиці активних/завершених батчів.
// Глобали: getDB, saveDB, esc, fmt, uid, getAllWorkerNames, wLabel,
// _currentUser, openModal, closeModal, logAudit, renderPage,
// calcCanProduce, calcCost, effectiveNeed.

(function(){
  'use strict';

  // ==================== PRODUCTION ====================
  function populateStartProd() {
    var db = getDB();
    document.getElementById('sp-search').value = '';
    document.getElementById('sp-product').value = '';
    document.getElementById('sp-info').innerHTML = '';
    filterSpProducts();
    var sw = document.getElementById('sp-worker');
    sw.innerHTML = getAllWorkerNames().map(function(w){return '<option value="'+esc(w)+'">'+esc(wLabel(w))+'</option>';}).join('');
  }
  
  function filterSpProducts() {
    var db = getDB();
    var q = (document.getElementById('sp-search').value || '').toLowerCase();
    var products = db.products.filter(function(p){ return p.active !== false; });
    if (q) {
      products = products.filter(function(p){
        return (p.name||'').toLowerCase().indexOf(q) !== -1 || (p.sku||'').toLowerCase().indexOf(q) !== -1;
      });
    }
    var dd = document.getElementById('sp-dropdown');
    dd.innerHTML = products.map(function(p){
      var can = calcCanProduce(p, db.materials);
      var label = (p.sku ? p.sku + ' — ' : '') + esc(p.name);
      return '<div onclick="selectSpProduct(\''+p.id+'\')" style="padding:10px 12px;cursor:pointer;font-size:14px;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center;" onmouseover="this.style.background=\'var(--bg)\'" onmouseout="this.style.background=\'#fff\'">' +
        '<span>'+label+'</span><span style="font-size:12px;color:'+(can>0?'var(--success)':'var(--danger)')+';">можна: '+can+'</span></div>';
    }).join('') || '<div style="padding:12px;color:var(--text-light);font-size:13px;text-align:center;">Нічого не знайдено</div>';
    dd.style.display = 'block';
  }
  
  // Модалка з вибором дії при недостачі: миттєво виготовити / запустити у виробництво
  // Підтримка кількох позицій — створюємо партію для кожної.
  window._shortageCtx = null; // { orderId, orderNum, items:[{productId, qty}], worker }
  
  function openShortageActionModal(ord, shortItems) {
    var defaultWorker = ord.worker || '';
    window._shortageCtx = {
      orderId: ord.id,
      orderNum: ord.num,
      items: shortItems.map(function(p){
        // Шукаємо майстра по позиції замовлення (per-item) → fallback на ord.worker
        var orderItem = (ord.items||[]).find(function(oi){ return oi.productId === p.productId; });
        var w = (orderItem && orderItem.worker) ? orderItem.worker : defaultWorker;
        return { productId: p.productId, qty: p.shortage, name: p.name, worker: w };
      })
    };
    renderShortageActionBody();
    openModal('shortage-action');
  }
  
  function renderShortageActionBody() {
    var ctx = window._shortageCtx;
    if (!ctx) return;
    var db = getDB();
    var workerNames = (typeof getAllWorkerNames === 'function') ? getAllWorkerNames() : [];
    var body = '<div style="font-size:14px;margin-bottom:12px;">Замовлення <strong>#'+ctx.orderNum+'</strong> — не вистачає на складі:</div>';
    ctx.items.forEach(function(it, idx){
      var workerOpts = '<option value="">— не призначено —</option>' + workerNames.map(function(w){
        return '<option value="'+esc(w)+'" '+(it.worker===w?'selected':'')+'>'+esc(typeof wLabel==='function'?wLabel(w):w)+'</option>';
      }).join('');
      // Чи можна виготовити цю позицію? (товар має бути в каталозі)
      var blockReason = _shortageItemBlockReason(db, it);
      var cardBg = blockReason ? '#FFEBEE' : '#FFF8E1';
      var cardBorder = blockReason ? '#EF9A9A' : '#FFE0B2';
      var warnBlock = blockReason
        ? '<div style="background:#fff;border:1px solid #EF9A9A;border-radius:8px;padding:8px 10px;margin-bottom:8px;font-size:12px;color:#C62828;">'+
            '⚠ <strong>Не можна виготовити:</strong> товар не привʼязаний до каталогу.<br>'+
            'Закрий це вікно → ✏️ біля замовлення → обери гру з каталогу.'+
          '</div>'
        : '';
      body += '<div style="background:'+cardBg+';border:1px solid '+cardBorder+';border-radius:10px;padding:12px;margin-bottom:10px;">'+
        '<div style="font-size:14px;margin-bottom:8px;"><strong>'+esc(it.name)+'</strong> — '+it.qty+' шт</div>'+
        warnBlock+
        '<div class="form-row" style="gap:8px;">'+
          '<div class="form-group" style="flex:2;"><label style="font-size:11px;">Майстер</label>'+
            '<select onchange="window._shortageCtx.items['+idx+'].worker=this.value">'+workerOpts+'</select>'+
          '</div>'+
          '<div class="form-group" style="flex:1;"><label style="font-size:11px;">К-сть</label>'+
            '<input type="number" min="1" value="'+it.qty+'" onchange="window._shortageCtx.items['+idx+'].qty=Math.max(1,parseInt(this.value)||1)">'+
          '</div>'+
        '</div>'+
      '</div>';
    });
    body += '<div style="font-size:13px;color:var(--text-light);margin-top:10px;">Що робимо?</div>';
    document.getElementById('shortage-action-body').innerHTML = body;
  }
  
  // Створити партію виробництва напряму (без модалки)
  function createProductionBatchDirect(productId, qty, worker, instant) {
    var db = getDB();
    var p = db.products.find(function(x){ return x.id === productId; });
    if (!p) return false;
    if (!db.workerStock) db.workerStock = [];
    // Списання матеріалів за рецептурою (як у startProduction)
    for (var i=0; i<(p.recipe||[]).length; i++) {
      var r = p.recipe[i];
      var mat = db.materials.find(function(m){ return m.id === r.materialId; });
      if (!mat) continue;
      var need = r.qty * qty;
      if (typeof isPaperMaterial === 'function' && isPaperMaterial(mat)) {
        mat.qty = Math.max(0, mat.qty - need);
      } else {
        var ws = db.workerStock.find(function(s){ return s.worker===worker && s.itemId===r.materialId && s.type==='material'; });
        if (ws) ws.qty = Math.max(0, ws.qty - need);
      }
    }
    var today = new Date().toISOString().slice(0,10);
    var newId = uid();
    if (instant) {
      db.production.push({ id:newId, productId:productId, qty:qty, worker:worker, date:today, status:'completed', completedQty:qty, completedDate:today });
      p.stock = (p.stock||0) + qty;
    } else {
      p.inProgress = (p.inProgress||0) + qty;
      db.production.push({ id:newId, productId:productId, qty:qty, worker:worker, date:today, status:'in_progress', completedQty:0 });
    }
    saveDB(db);
    return newId;
  }
  
  // Перевірка чи можна виготовити позицію. Повертає '' якщо ОК, або текст помилки.
  function _shortageItemBlockReason(db, it) {
    if (!it.productId) {
      return '«'+(it.name||'?')+'» — позиція не привʼязана до товару каталогу.';
    }
    var p = db.products.find(function(x){ return x.id === it.productId; });
    if (!p) {
      return '«'+(it.name||'?')+'» — товар не знайдено в каталозі (можливо видалений або перестворений).';
    }
    return '';
  }

  function shortageDoInstant() {
    if (!window._shortageCtx) return;
    var ctx = window._shortageCtx;
    var db = getDB();
    // Перед-перевірка: чи всі позиції привʼязані до існуючих товарів
    var blocked = [];
    ctx.items.forEach(function(it){
      var reason = _shortageItemBlockReason(db, it);
      if (reason) blocked.push(reason);
    });
    if (blocked.length) {
      alert('❌ Не можна виготовити:\n\n' + blocked.join('\n\n') +
        '\n\n👉 Закрий це вікно, натисни ✏️ біля замовлення і обери товар з каталогу для кожної позиції.');
      return;
    }
    // Перевірка: кожній позиції має бути присвоєний майстер (для нарахування ЗП)
    var unassigned = ctx.items.filter(function(it){ return !it.worker; });
    if (unassigned.length) {
      if (!confirm('⚠ У '+unassigned.length+' позиц. не призначений майстер — ЗП за ці партії не нарахується. Продовжити?')) return;
    }
    closeModal('shortage-action');
    var ok = 0, fail = 0;
    var batchIds = [];
    ctx.items.forEach(function(it){
      var bid = createProductionBatchDirect(it.productId, it.qty, it.worker, true);
      if (bid) { ok++; batchIds.push(bid); } else { fail++; }
    });
    window._shortageCtx = null;
    renderPage('orders');
    if (ok > 0) showInstantUndoToast(batchIds, ok);
    if (fail > 0) alert('⚠ Не вдалось виготовити '+fail+' партій.');
  }
  
  function showInstantUndoToast(batchIds, count) {
    showUndoToast({
      text: '✅ Виготовлено готових партій: <strong>'+count+'</strong>. Натисни 📤 для відправки.',
      bg: '#2E7D32',
      onUndo: function(){
        if (!confirm('Видалити '+count+' готових партій? Склад зменшиться, ЗП відкотиться.')) return false;
        var db = getDB();
        batchIds.forEach(function(bid){
          var batch = db.production.find(function(x){return x.id===bid;});
          if (!batch) return;
          var p = db.products.find(function(x){return x.id===batch.productId;});
          if (p) p.stock = Math.max(0, (p.stock||0) - (batch.completedQty||batch.qty));
          db.production = db.production.filter(function(x){return x.id!==bid;});
        });
        saveDB(db);
        renderPage('orders');
        return true;
      }
    });
  }
  
  function shortageDoProduce() {
    if (!window._shortageCtx) return;
    var ctx = window._shortageCtx;
    var db = getDB();
    // Перед-перевірка: чи всі позиції привʼязані до існуючих товарів
    var blocked = [];
    ctx.items.forEach(function(it){
      var reason = _shortageItemBlockReason(db, it);
      if (reason) blocked.push(reason);
    });
    if (blocked.length) {
      alert('❌ Не можна запустити у виробництво:\n\n' + blocked.join('\n\n') +
        '\n\n👉 Закрий це вікно, натисни ✏️ біля замовлення і обери товар з каталогу для кожної позиції.');
      return;
    }
    var unassigned = ctx.items.filter(function(it){ return !it.worker; });
    if (unassigned.length) {
      if (!confirm('⚠ У '+unassigned.length+' позиц. не призначений майстер. Продовжити?')) return;
    }
    closeModal('shortage-action');
    var ok = 0, fail = 0;
    var batchIds = [];
    ctx.items.forEach(function(it){
      var bid = createProductionBatchDirect(it.productId, it.qty, it.worker, false);
      if (bid) { ok++; batchIds.push(bid); } else { fail++; }
    });
    window._shortageCtx = null;
    renderPage('orders');
    if (ok > 0) showProduceUndoToast(batchIds, ok);
    if (fail > 0) alert('⚠ Не вдалось запустити '+fail+' партій.');
  }
  
  function showProduceUndoToast(batchIds, count) {
    showUndoToast({
      text: '🛠 Запущено партій у роботу: <strong>'+count+'</strong>. Майстер здасть → склад поповниться → 📤.',
      bg: '#1565C0',
      onUndo: function(){
        if (!confirm('Видалити '+count+' партій з виробництва? Матеріали не повернуться.')) return false;
        var db = getDB();
        batchIds.forEach(function(bid){
          var batch = db.production.find(function(x){return x.id===bid;});
          if (!batch) return;
          var p = db.products.find(function(x){return x.id===batch.productId;});
          if (p) p.inProgress = Math.max(0, (p.inProgress||0) - batch.qty);
          db.production = db.production.filter(function(x){return x.id!==bid;});
        });
        saveDB(db);
        renderPage('orders');
        return true;
      }
    });
  }
  
  // Універсальний хелпер undo-тоста
  function showUndoToast(opts) {
    var existing = document.getElementById('instant-toast');
    if (existing) existing.remove();
    var t = document.createElement('div');
    t.id = 'instant-toast';
    t.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:'+(opts.bg||'#2E7D32')+';color:#fff;padding:14px 20px;border-radius:12px;box-shadow:0 6px 20px rgba(0,0,0,0.25);z-index:10000;display:flex;gap:14px;align-items:center;font-size:14px;max-width:90vw;';
    t.innerHTML = '<span>'+opts.text+'</span>'+
      '<button id="instant-undo-btn" style="background:#fff;color:'+(opts.bg||'#2E7D32')+';border:none;padding:6px 14px;border-radius:8px;font-weight:600;cursor:pointer;">↩ Скасувати</button>'+
      '<button id="instant-close-btn" style="background:transparent;color:#fff;border:1px solid rgba(255,255,255,0.5);padding:6px 10px;border-radius:8px;cursor:pointer;">✕</button>';
    document.body.appendChild(t);
    document.getElementById('instant-undo-btn').onclick = function(){
      var done = opts.onUndo ? opts.onUndo() : true;
      if (done) t.remove();
    };
    document.getElementById('instant-close-btn').onclick = function(){ t.remove(); };
    setTimeout(function(){ if (document.body.contains(t)) t.remove(); }, 15000);
  }
  
  // Швидке відкриття модалки виробництва з пре-заповненням з замовлення
  function openProductionForOrder(productId, qty, worker) {
    openModal('start-production');
    setTimeout(function(){
      if (productId) selectSpProduct(productId);
      var qtyEl = document.getElementById('sp-qty');
      if (qtyEl) { qtyEl.value = qty || 1; }
      if (worker) {
        var wEl = document.getElementById('sp-worker');
        if (wEl) {
          for (var i=0; i<wEl.options.length; i++) {
            if (wEl.options[i].value === worker) { wEl.selectedIndex = i; break; }
          }
        }
      }
      if (typeof checkCanProduce === 'function') checkCanProduce();
    }, 100);
  }
  
  function selectSpProduct(id) {
    var db = getDB();
    var p = db.products.find(function(x){ return x.id === id; });
    if (!p) return;
    document.getElementById('sp-product').value = id;
    document.getElementById('sp-search').value = (p.sku ? p.sku + ' — ' : '') + p.name;
    document.getElementById('sp-dropdown').style.display = 'none';
    checkCanProduce();
  }
  
  // Close dropdown when clicking outside
  document.addEventListener('click', function(e) {
    var dd = document.getElementById('sp-dropdown');
    if (dd && !e.target.closest('#sp-search') && !e.target.closest('#sp-dropdown')) {
      dd.style.display = 'none';
    }
  });
  
  // Deduction plan: для кожного матеріалу — скільки взяти зі складу майстра, скільки з головного, скільки бракує
  // `need` включає wastePercent матеріалу (округлюється вгору якщо waste > 0)
  function planProductionDeduction(db, p, qty, worker) {
    var rows = [];
    (p.recipe||[]).forEach(function(r){
      var mat = (db.materials||[]).find(function(m){return m.id===r.materialId});
      if(!mat) return;
      var base = r.qty * qty;
      var need = effectiveNeed(mat, r.qty, qty);
      var wasteAddon = need - base;
      if (isPaperMaterial(mat)) {
        var atMain = mat.qty || 0;
        rows.push({ mat:mat, need:need, base:base, wasteAddon:wasteAddon, fromWorker:0, fromMain:Math.min(need, atMain), shortage:Math.max(0, need-atMain), paper:true, atWorker:0, atMain:atMain });
      } else {
        var ws = worker ? (db.workerStock||[]).find(function(s){return s.worker===worker && s.itemId===r.materialId && s.type==='material'}) : null;
        var atWorker = ws ? (ws.qty||0) : 0;
        var atMain = mat.qty || 0;
        var fromWorker = Math.min(need, atWorker);
        var fromMain = Math.min(need - fromWorker, atMain);
        var shortage = Math.max(0, need - fromWorker - fromMain);
        rows.push({ mat:mat, need:need, base:base, wasteAddon:wasteAddon, fromWorker:fromWorker, fromMain:fromMain, shortage:shortage, paper:false, atWorker:atWorker, atMain:atMain });
      }
    });
    return rows;
  }
  
  function checkCanProduce() {
    var db = getDB();
    var p = db.products.find(function(x){return x.id===v('sp-product')});
    if(!p) return;
    var qty = parseInt(document.getElementById('sp-qty').value)||1;
    var worker = v('sp-worker') || '';
    var info = document.getElementById('sp-info');
    if (!p.recipe || !p.recipe.length) {
      info.innerHTML = '<span class="text-muted">Без рецепту — нічого не списується.</span>';
      return;
    }
    var plan = planProductionDeduction(db, p, qty, worker);
    var anyShort = plan.some(function(r){return r.shortage>0});
    var lines = plan.map(function(r){
      var u = esc(r.mat.unit||'');
      var src = [];
      if (r.fromWorker>0) src.push('👷 у майстра: '+fmt(r.fromWorker)+' '+u);
      if (r.fromMain>0)   src.push('📦 зі складу: '+fmt(r.fromMain)+' '+u);
      if (r.shortage>0)   src.push('<span style="color:var(--danger);">❌ бракує: '+fmt(r.shortage)+' '+u+'</span>');
      if (!src.length)    src.push('—');
      var wasteNote = r.wasteAddon > 0 ? ' <small style="color:var(--text-light);">(базово '+fmt(r.base)+' + ♻️ '+fmt(r.wasteAddon)+' брак '+fmt(r.mat.wastePercent||0)+'%)</small>' : '';
      return '<div style="margin:2px 0;">• <strong>'+esc(r.mat.name)+'</strong> ('+fmt(r.need)+' '+u+wasteNote+'): '+src.join(', ')+'</div>';
    }).join('');
    var header = anyShort
      ? '<div style="color:var(--danger);font-weight:600;margin-bottom:4px;">⚠ Не вистачає матеріалів — можна запустити в борг</div>'
      : '<div style="color:var(--success);font-weight:600;margin-bottom:4px;">✓ Матеріалів достатньо. Буде списано:</div>';
    info.innerHTML = header + lines;
  }
  
  function isPaperMaterial(mat) {
    var name = (mat.name||'').toLowerCase();
    return name.indexOf('бумаг') !== -1 || name.indexOf('папір') !== -1 || name.indexOf('папер') !== -1;
  }
  
  function startProduction() {
    var db = getDB();
    if (!db.workerStock) db.workerStock = [];
    var productId = v('sp-product');
    var qty = parseInt(document.getElementById('sp-qty').value)||1;
    var worker = v('sp-worker');
    var p = db.products.find(function(x){return x.id===productId});
    if(!p) return;
  
    // Plan: paper from main; інші — спочатку склад майстра, потім головний склад
    var plan = planProductionDeduction(db, p, qty, worker);
    var planLines = plan.map(function(r){
      var u = r.mat.unit||'';
      var parts = [];
      if (r.fromWorker>0) parts.push('👷 майстер: '+fmt(r.fromWorker)+' '+u);
      if (r.fromMain>0)   parts.push('📦 склад: '+fmt(r.fromMain)+' '+u);
      if (r.shortage>0)   parts.push('❌ бракує: '+fmt(r.shortage)+' '+u);
      return '• '+r.mat.name+' ('+fmt(r.need)+' '+u+'): '+(parts.join(', ')||'—');
    }).join('\n');
    var anyShort = plan.some(function(r){return r.shortage>0});
    var instantElPre = document.getElementById('sp-instant');
    var isInstantPre = instantElPre && instantElPre.checked;
    if(anyShort && !isInstantPre) {
      if(!confirm('Не вистачає матеріалів. Запустити в борг?\n\n'+planLines+'\n\nЗапустити все одно?')) return;
    } else if (planLines) {
      if(!confirm('Підтвердити запуск виробництва. Буде списано:\n\n'+planLines+'\n\nЗапустити?')) return;
    }
  
    // Deduct
    plan.forEach(function(r){
      if (r.fromWorker > 0) {
        var ws = db.workerStock.find(function(s){return s.worker===worker && s.itemId===r.mat.id && s.type==='material'});
        if (ws) {
          ws.qty = (ws.qty||0) - r.fromWorker;
          if (ws.qty <= 0) db.workerStock = db.workerStock.filter(function(s){return s.id !== ws.id});
        }
      }
      if (r.fromMain > 0) {
        r.mat.qty = Math.max(0, (r.mat.qty||0) - r.fromMain);
      }
    });
  
    var instantEl = document.getElementById('sp-instant');
    var instant = instantEl && instantEl.checked;
    var today = new Date().toISOString().slice(0,10);
    if (instant) {
      // Одразу видати готовою: статус completed, +stock
      db.production.push({ id:uid(), productId:productId, qty:qty, worker:worker, date:today, status:'completed', completedQty:qty, completedDate:today });
      p.stock = (p.stock||0) + qty;
    } else {
      p.inProgress = (p.inProgress||0) + qty;
      db.production.push({ id:uid(), productId:productId, qty:qty, worker:worker, date:today, status:'in_progress', completedQty:0 });
    }
    saveDB(db);
    closeModal('start-production');
    if (instant) {
      alert('✅ Виготовлено '+qty+' шт. Тепер натисни 📤 на замовленні щоб відправити.');
    }
    renderPage(instant ? 'orders' : 'production');
  }
  
  function populateCompleteProd() {
    var db = getDB();
    var active = db.production.filter(function(x){return x.status==='in_progress'});
    var sel = document.getElementById('cp-batch');
    sel.innerHTML = active.map(function(b) {
      var p = db.products.find(function(x){return x.id===b.productId});
      return '<option value="'+b.id+'">'+(p?esc(p.name):'?')+' — '+b.qty+' шт ('+esc(wLabel(b.worker))+', '+b.date+')</option>';
    }).join('') || '<option value="">Немає активного виробництва</option>';
    if(active.length>0) {
      document.getElementById('cp-qty').value = active[0].qty;
      document.getElementById('cp-qty').max = active[0].qty;
    }
    sel.onchange = function() {
      var batch = active.find(function(x){return x.id===sel.value});
      if(batch) {
        document.getElementById('cp-qty').value = batch.qty;
        document.getElementById('cp-qty').max = batch.qty;
      }
    };
    // Populate destination select with fulfillment locations
    var destSel = document.getElementById('cp-destination');
    if (destSel) {
      var locs = db.fulfillmentLocations || ['Розетка'];
      destSel.innerHTML = '<option value="main">📦 Мій склад (головний)</option>' +
        locs.map(function(l){ return '<option value="ff:'+esc(l)+'">🏬 '+esc(l)+' (фулфілмент)</option>'; }).join('');
      destSel.value = 'main';
      document.getElementById('cp-dest-hint').textContent = 'На ваш головний склад';
    }
    // Reset comment field on each open
    var noteEl = document.getElementById('cp-note');
    if (noteEl) { noteEl.value = ''; noteEl.style.borderColor = ''; }
  }
  
  function completeProduction() {
    var db = getDB();
    var batchId = v('cp-batch');
    var qty = parseInt(document.getElementById('cp-qty').value)||0;
    var batch = db.production.find(function(x){return x.id===batchId});
    if(!batch || qty<=0) return alert('Оберіть партію');
    if(qty > batch.qty) return alert('Не можна здати більше ніж в роботі ('+batch.qty+' шт)');
    var noteEl = document.getElementById('cp-note');
    var note = (noteEl && noteEl.value || '').trim();
    var p = db.products.find(function(x){return x.id===batch.productId});
    var destination = v('cp-destination') || 'main';
    if(p) {
      if (destination.indexOf('ff:') === 0) {
        // Send directly to fulfillment
        var ffLoc = destination.substring(3);
        if (!p.fulfillment) p.fulfillment = {};
        p.fulfillment[ffLoc] = (p.fulfillment[ffLoc]||0) + qty;
      } else {
        // Main stock
        p.stock = (p.stock||0) + qty;
      }
      p.inProgress = Math.max(0, (p.inProgress||0) - qty);
      // Template fast-amortization: advance the covered counter (capped at templateQty)
      if ((p.templateCost||0) > 0 && (p.templateQty||0) > 0) {
        var newCovered = (p.templateCovered||0) + qty;
        p.templateCovered = Math.min(newCovered, p.templateQty);
      }
    }
    if(qty < batch.qty) {
      // Partial completion: create completed record, reduce batch
      var destLabel = destination.indexOf('ff:')===0 ? destination.substring(3) : '';
      db.production.push({ id:uid(), productId:batch.productId, qty:qty, worker:batch.worker, date:batch.date, status:'completed', completedQty:qty, completedDate:new Date().toISOString().slice(0,10), fulfillmentDest:destLabel, completionNote:note });
      batch.qty -= qty;
      logAudit(db, 'production', batch.id, 'complete', { product: p?p.name:'?', qty: qty, partial: true, worker: batch.worker, dest: destination, note: note });
    } else {
      // Full completion
      batch.status = 'completed';
      batch.completedQty = qty;
      batch.completedDate = new Date().toISOString().slice(0,10);
      batch.fulfillmentDest = destination.indexOf('ff:')===0 ? destination.substring(3) : '';
      batch.completionNote = note;
      logAudit(db, 'production', batch.id, 'complete', { product: p?p.name:'?', qty: qty, partial: false, worker: batch.worker, dest: destination, note: note });
    }
    saveDB(db);
    closeModal('complete-production');
    renderPage('production');
  }
  
  function toggleAllProdSelected(checked) {
    document.querySelectorAll('.prodbatch-cb').forEach(function(cb){ cb.checked = checked; });
    updateProdSelectedCount();
  }
  
  function updateProdSelectedCount() {
    var selected = document.querySelectorAll('.prodbatch-cb:checked');
    var btn = document.getElementById('bulk-complete-selected-btn');
    if (!btn) return;
    if (selected.length > 0) {
      btn.style.display = 'inline-block';
      btn.textContent = '✅ Здати обрані ('+selected.length+')';
    } else {
      btn.style.display = 'none';
    }
  }
  
  function bulkCompleteSelected() {
    var ids = [];
    document.querySelectorAll('.prodbatch-cb:checked').forEach(function(cb){ ids.push(cb.value); });
    if (!ids.length) return;
    if (!confirm('Здати на склад '+ids.length+' обраних партій?')) return;
    completeBatchesByIds(ids);
  }
  
  function completeBatchesByIds(ids) {
    var db = getDB();
    var today = new Date().toISOString().slice(0,10);
    var done = 0;
    ids.forEach(function(id){
      var b = db.production.find(function(x){ return x.id === id; });
      if (!b || b.status !== 'in_progress') return;
      var p = db.products.find(function(x){ return x.id === b.productId; });
      var qty = b.qty || 0;
      b.status = 'completed';
      b.completedQty = qty;
      b.completedDate = today;
      if (p) {
        p.inProgress = Math.max(0, (p.inProgress||0) - qty);
        p.stock = (p.stock||0) + qty;
      }
      done++;
    });
    saveDB(db);
    renderPage('production');
    showUndoToast({
      text: '✅ Здано '+done+' партій. Склад поповнився.',
      bg: '#2E7D32',
      onUndo: function(){
        if (!confirm('Повернути '+done+' партій у статус "В роботі"?')) return false;
        var db2 = getDB();
        ids.forEach(function(id){
          var b = db2.production.find(function(x){ return x.id === id; });
          if (!b || b.status !== 'completed') return;
          var p = db2.products.find(function(x){ return x.id === b.productId; });
          var qty = b.completedQty || b.qty || 0;
          b.status = 'in_progress';
          if (p) {
            p.stock = Math.max(0, (p.stock||0) - qty);
            p.inProgress = (p.inProgress||0) + qty;
          }
          b.completedQty = 0;
          b.completedDate = null;
        });
        saveDB(db2);
        renderPage('production');
        return true;
      }
    });
  }
  
  function bulkCompleteVisible() {
    var btn = document.getElementById('bulk-complete-btn');
    if (!btn) return;
    var ids = (btn.dataset.ids||'').split(',').filter(Boolean);
    if (!ids.length) return;
    if (!confirm('Здати на склад ВСІ '+ids.length+' активних партій?')) return;
    completeBatchesByIds(ids);
  }
  
  function renderProduction() {
    var db = getDB();
    var isW = isCurrentUserWorker();
    var myNames = isW ? getCurrentWorkerAliases().map(function(n){return (n||'').trim().toLowerCase();}) : [];
    var byWorker = function(x) {
      if (!isW) return true;
      var xw = (x.worker||'').trim().toLowerCase();
      return myNames.indexOf(xw) !== -1;
    };
    // Owner-side worker filter dropdown
    var prodWorkerFilter = '';
    var wfWrap = document.getElementById('prod-filters');
    if (wfWrap) wfWrap.style.display = isW ? 'none' : 'flex';
    var wfSel = document.getElementById('prod-worker-filter');
    if (wfSel && !isW) {
      var curVal = wfSel.value;
      // Collect worker names used in production
      var usedSet = {};
      db.production.forEach(function(x){ if (x.worker) usedSet[x.worker] = true; });
      // Merge with known workers to keep list stable even if nothing in production yet
      (getAllWorkerNames ? getAllWorkerNames() : []).forEach(function(w){ if (w) usedSet[w] = true; });
      var workerOpts = Object.keys(usedSet).sort();
      wfSel.innerHTML = '<option value="">Всі майстри</option>' +
        workerOpts.map(function(w){ return '<option value="'+esc(w)+'" '+(curVal===w?'selected':'')+'>'+esc(typeof wLabel==='function'?wLabel(w):w)+'</option>'; }).join('');
      prodWorkerFilter = curVal;
    }
    var byFilter = function(x) {
      if (!prodWorkerFilter) return true;
      return (x.worker||'') === prodWorkerFilter;
    };
    var active = db.production.filter(function(x){return x.status==='in_progress' && byWorker(x) && byFilter(x)});
    var history = db.production.filter(function(x){return x.status==='completed' && byWorker(x) && byFilter(x)}).reverse().slice(0,50);
  
    // Compute per-batch worker pay (qty × rate). Returns { amount, rate, rateLabel, qty }.
    // Same formula as calcWorkerEarnings / renderSalary — for ЗП-reconciliation.
    function batchPay(b, useCompletedQty) {
      var p = db.products.find(function(x){return x.id===b.productId});
      if (!p) return { amount: 0, rate: 0, rateLabel: '?', qty: 0 };
      var rType = p.workerRateType || (db.workerRateDefault||{}).type || 'percent';
      var rVal = p.workerRate || (db.workerRateDefault||{}).value || 25;
      var rate = rType === 'percent' ? Math.round((p.sellPrice||0) * rVal / 100) : rVal;
      var rateLabel = rType === 'percent' ? rVal + '% від ' + fmt(p.sellPrice||0) + ' грн' : 'фікс ' + fmt(rVal) + ' грн';
      var qty = useCompletedQty ? (b.completedQty || b.qty) : b.qty;
      return { amount: rate * qty, rate: rate, rateLabel: rateLabel, qty: qty };
    }
  
    // Кнопка "Здати все" — видима тільки якщо є активні і ми не worker
    var bulkBtn = document.getElementById('bulk-complete-btn');
    var activeTotalPay = active.reduce(function(s,b){ return s + batchPay(b, false).amount; }, 0);
    if (bulkBtn) {
      bulkBtn.style.display = (!isW && active.length > 1) ? 'inline-block' : 'none';
      bulkBtn.dataset.ids = active.map(function(b){ return b.id; }).join(',');
      var workerLbl = prodWorkerFilter ? ' ('+prodWorkerFilter+')' : '';
      bulkBtn.textContent = '✅ Здати все' + workerLbl + ' — ' + active.length + (activeTotalPay > 0 ? ' • ' + fmt(activeTotalPay) + ' грн' : '');
    }
    document.getElementById('production-active').innerHTML = active.map(function(b) {
      var p = db.products.find(function(x){return x.id===b.productId});
      var pay = batchPay(b, false);
      var payCell = pay.amount > 0
        ? '<span style="color:#6A1B9A;font-weight:600;" title="'+pay.qty+' × '+fmt(pay.rate)+' грн ('+esc(pay.rateLabel)+')">'+fmt(pay.amount)+' грн</span>'
        : '<span class="text-muted" title="Ставка майстра не задана для цієї гри">—</span>';
      return '<tr>'+
        '<td><input type="checkbox" class="prodbatch-cb" value="'+b.id+'" onchange="updateProdSelectedCount()"></td>'+
        '<td data-label="Дата">'+b.date+'</td><td data-label="Артикул"><code>'+(p?esc(p.sku||''):'-')+'</code></td><td data-label="Гра">'+(p?esc(p.name):'?')+'</td><td data-label="К-сть"><strong>'+b.qty+'</strong></td>'+
        '<td data-label="Сума ЗП">'+payCell+'</td>'+
        '<td data-label="Майстер">'+esc(wLabel(b.worker))+'</td>'+
        '<td data-label="Статус"><span class="badge badge-warning">В роботі</span></td>'+
        '<td data-label="Дії" style="white-space:nowrap;">'+
          '<button class="btn btn-success btn-sm" onclick="quickComplete(\''+b.id+'\')" title="Здати">Здати</button> '+
          '<button class="btn btn-outline btn-sm" onclick="editProductionBatch(\''+b.id+'\')" title="Редагувати">✏️</button> '+
          '<button class="btn btn-danger btn-sm" onclick="deleteProductionBatch(\''+b.id+'\')" title="Видалити">🗑</button>'+
        '</td>'+
      '</tr>';
    }).join('') || '<tr><td colspan="9" class="text-muted" style="text-align:center;padding:20px;">Немає активного виробництва</td></tr>';
  
    document.getElementById('production-history').innerHTML = history.map(function(b) {
      var p = db.products.find(function(x){return x.id===b.productId});
      var noteHtml = b.completionNote ? '<div style="font-size:11px;color:#6D4C00;background:#FFF8E1;border-left:3px solid #FFC107;padding:3px 6px;margin-top:4px;border-radius:3px;white-space:normal;">💬 '+esc(b.completionNote)+'</div>' : '';
      var pay = batchPay(b, true);
      var payCell = pay.amount > 0
        ? '<span style="color:#6A1B9A;font-weight:600;" title="'+pay.qty+' × '+fmt(pay.rate)+' грн ('+esc(pay.rateLabel)+')">'+fmt(pay.amount)+' грн</span>'
        : '<span class="text-muted" title="Ставка майстра не задана для цієї гри">—</span>';
      return '<tr><td data-label="Дата">'+(b.completedDate||b.date)+'</td><td data-label="Артикул"><code>'+(p?esc(p.sku||''):'-')+'</code></td><td data-label="Гра">'+(p?esc(p.name):'?')+noteHtml+'</td><td data-label="К-сть">'+(b.completedQty||b.qty)+'</td>'+
        '<td data-label="Сума ЗП">'+payCell+'</td>'+
        '<td data-label="Майстер">'+esc(wLabel(b.worker))+'</td>'+
        '<td data-label="Статус"><span class="badge badge-success">Готово</span>'+(b.fulfillmentDest?' <span class="badge" style="background:#E1BEE7;color:#4A148C;font-size:10px;">🏬 '+esc(b.fulfillmentDest)+'</span>':'')+'</td>'+
        '<td data-label="Дії" style="white-space:nowrap;">'+
          '<button class="btn btn-outline btn-sm" onclick="editCompletedBatch(\''+b.id+'\')" title="Редагувати">✏️</button> '+
          '<button class="btn btn-danger btn-sm" onclick="deleteCompletedBatch(\''+b.id+'\')" title="Видалити">🗑</button>'+
        '</td>'+
      '</tr>';
    }).join('') || '<tr><td colspan="8" class="text-muted" style="text-align:center;padding:20px;">Історія порожня</td></tr>';
  }
  
  function quickComplete(batchId) {
    var db = getDB();
    var batch = db.production.find(function(x){return x.id===batchId});
    if(!batch) return;
    openModal('complete-production');
    // After openModal populates the list, select the correct batch
    var sel = document.getElementById('cp-batch');
    sel.value = batchId;
    document.getElementById('cp-qty').value = batch.qty;
    document.getElementById('cp-qty').max = batch.qty;
  }
  
  function editProductionBatch(batchId) {
    var db = getDB();
    var batch = db.production.find(function(x){return x.id===batchId});
    if(!batch) return;
    var p = db.products.find(function(x){return x.id===batch.productId});
    var newQty = prompt('Кількість в роботі (зараз: '+batch.qty+'):', batch.qty);
    if(newQty === null) return;
    newQty = parseInt(newQty)||0;
    if(newQty <= 0) return alert('Кількість має бути більше 0');
    var diff = newQty - batch.qty;
    if(p) p.inProgress = Math.max(0, (p.inProgress||0) + diff);
    batch.qty = newQty;
    saveDB(db);
    renderPage('production');
  }
  
  function deleteProductionBatch(batchId) {
    var db = getDB();
    var batch = db.production.find(function(x){return x.id===batchId});
    if(!batch) return;
    var msg = batch.status === 'completed'
      ? 'Видалити партію зі статусом "готова"?\n\nГотова продукція повернеться зі складу (-'+(batch.completedQty||batch.qty)+' шт). Матеріали не повернуться.'
      : 'Видалити запис виробництва? (Матеріали не повернуться)';
    if(!confirm(msg)) return;
    var p = db.products.find(function(x){return x.id===batch.productId});
    if (p) {
      if (batch.status === 'completed') {
        p.stock = Math.max(0, (p.stock||0) - (batch.completedQty || batch.qty));
      } else {
        p.inProgress = Math.max(0, (p.inProgress||0) - batch.qty);
      }
    }
    db.production = db.production.filter(function(x){return x.id!==batchId});
    saveDB(db);
    renderPage('production');
  }
  
  function editCompletedBatch(batchId) {
    var db = getDB();
    var batch = db.production.find(function(x){return x.id===batchId});
    if(!batch) return;
    var p = db.products.find(function(x){return x.id===batch.productId});
    var curQty = batch.completedQty || batch.qty;
    var newQty = prompt('Здано штук (зараз: '+curQty+'):', curQty);
    if(newQty === null) return;
    newQty = parseInt(newQty)||0;
    if(newQty <= 0) return alert('Кількість має бути більше 0');
    var diff = newQty - curQty;
    if(p) {
      p.stock = Math.max(0, (p.stock||0) + diff);
      if ((p.templateCost||0) > 0 && (p.templateQty||0) > 0) {
        var nc = (p.templateCovered||0) + diff;
        p.templateCovered = Math.min(Math.max(0, nc), p.templateQty);
      }
    }
    batch.completedQty = newQty;
    batch.qty = newQty;
    logAudit(db, 'production', batch.id, 'edit', { product: p?p.name:'?', oldQty: curQty, newQty: newQty, worker: batch.worker });
    saveDB(db);
    renderPage('production');
  }
  
  function deleteCompletedBatch(batchId) {
    if(!confirm('Видалити запис з історії? (Кількість на складі зменшиться)')) return;
    var db = getDB();
    var batch = db.production.find(function(x){return x.id===batchId});
    if(!batch) return;
    var p = db.products.find(function(x){return x.id===batch.productId});
    var qty = batch.completedQty || batch.qty;
    if(p) {
      p.stock = Math.max(0, (p.stock||0) - qty);
      if ((p.templateCost||0) > 0 && (p.templateQty||0) > 0) {
        p.templateCovered = Math.max(0, (p.templateCovered||0) - qty);
      }
    }
    logAudit(db, 'production', batch.id, 'delete', { product: p?p.name:'?', qty: qty, worker: batch.worker, date: batch.completedDate||batch.date });
    db.production = db.production.filter(function(x){return x.id!==batchId});
    saveDB(db);
    renderPage('production');
  }

  // Експорт для inline-обробників і renderPage.
  // _shortageCtx — вже на window напряму (див. var window._shortageCtx вище),
  // тому не потребує окремого присвоєння.
  window.populateStartProd = populateStartProd;
  window.filterSpProducts = filterSpProducts;
  window.openShortageActionModal = openShortageActionModal;
  window.renderShortageActionBody = renderShortageActionBody;
  window.createProductionBatchDirect = createProductionBatchDirect;
  window.shortageDoInstant = shortageDoInstant;
  window.showInstantUndoToast = showInstantUndoToast;
  window.shortageDoProduce = shortageDoProduce;
  window.showProduceUndoToast = showProduceUndoToast;
  window.showUndoToast = showUndoToast;
  window.openProductionForOrder = openProductionForOrder;
  window.selectSpProduct = selectSpProduct;
  window.planProductionDeduction = planProductionDeduction;
  window.checkCanProduce = checkCanProduce;
  window.isPaperMaterial = isPaperMaterial;
  window.startProduction = startProduction;
  window.populateCompleteProd = populateCompleteProd;
  window.completeProduction = completeProduction;
  window.toggleAllProdSelected = toggleAllProdSelected;
  window.updateProdSelectedCount = updateProdSelectedCount;
  window.bulkCompleteSelected = bulkCompleteSelected;
  window.completeBatchesByIds = completeBatchesByIds;
  window.bulkCompleteVisible = bulkCompleteVisible;
  window.renderProduction = renderProduction;
  window.quickComplete = quickComplete;
  window.editProductionBatch = editProductionBatch;
  window.deleteProductionBatch = deleteProductionBatch;
  window.editCompletedBatch = editCompletedBatch;
  window.deleteCompletedBatch = deleteCompletedBatch;
})();
