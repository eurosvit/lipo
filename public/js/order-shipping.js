// ============================================================
// LipoLand — Order shipping module
// ============================================================
// Відправка замовлень: автоматична (planOrderShipment / shipOrderFromStock)
// та вручну (pick-shipment модалка — split з кількох джерел). Unship-логіка
// з коректним поверненням у склад/майстра/фулфілмент через o.shippedFrom.

(function(){
  'use strict';

  // ==================== SHIP ORDER FROM STOCK ====================
  // Майстер на замовленні = вказівник, з якого складу списати готовий товар.
  // Пріоритет: склад майстра → головний склад LipoLand. ЗП не нараховується —
  // виплачується при виробництві, а не при відправці.
  function planOrderShipment(db, ord) {
    var plan = [];
    // Якщо канал замовлення збігається з фулфілмент-локацією — звідти знімаємо першочергово
    var preferFf = '';
    var ffLocs = db.fulfillmentLocations || [];
    if (ord.channel) {
      var match = ffLocs.find(function(l){ return l.toLowerCase() === String(ord.channel).toLowerCase(); });
      if (match) preferFf = match;
    }
    (ord.items || []).forEach(function(item) {
      if (!item.productId) {
        plan.push({ productId:null, name:item.name, total:item.qty||0, fromMaster:0, fromMain:0, fromFf:{}, shortage:item.qty||0, wsId:null, product:null, noLink:true });
        return;
      }
      var need = item.qty || 0;
      var fromMaster = 0, fromMain = 0, ws = null;
      var fromFf = {};
      var p = (db.products || []).find(function(x){ return x.id === item.productId; });
  
      // 1) Якщо канал замовлення = фулфілмент-локація → беремо звідти першочергово
      if (preferFf && p && p.fulfillment && p.fulfillment[preferFf] > 0 && need > 0) {
        var take = Math.min(need, p.fulfillment[preferFf]);
        fromFf[preferFf] = take;
        need -= take;
      }
  
      // 2) Склад майстра (якщо до замовлення прив'язана майстриня)
      if (ord.worker && need > 0) {
        ws = (db.workerStock || []).find(function(s) {
          return s.worker === ord.worker && s.itemId === item.productId && s.type === 'product';
        });
        if (ws && ws.qty > 0) {
          fromMaster = Math.min(need, ws.qty);
          need -= fromMaster;
        }
      }
  
      // 3) Основний склад LipoLand
      if (p && need > 0) {
        fromMain = Math.min(need, p.stock || 0);
        need -= fromMain;
      }
  
      // 4) Інші фулфілмент-локації (якщо ще не вистачає)
      if (p && p.fulfillment && need > 0) {
        Object.keys(p.fulfillment).forEach(function(loc) {
          if (need <= 0) return;
          if (loc === preferFf) return; // вже взяли вище
          var avail = p.fulfillment[loc] || 0;
          if (avail > 0) {
            var t = Math.min(need, avail);
            fromFf[loc] = t;
            need -= t;
          }
        });
      }
  
      plan.push({
        productId: item.productId,
        name: item.name,
        total: item.qty || 0,
        fromMaster: fromMaster,
        fromMain: fromMain,
        fromFf: fromFf,
        shortage: need,
        wsId: ws ? ws.id : null,
        product: p
      });
    });
    return plan;
  }
  
  function orderStockHint(ord) {
    var db = getDB();
    var plan = planOrderShipment(db, ord);
    var parts = [];
    var totalMaster = 0, totalMain = 0, totalShortage = 0;
    plan.forEach(function(p) {
      totalMaster += p.fromMaster;
      totalMain += p.fromMain;
      totalShortage += p.shortage;
    });
    if (totalMaster > 0) parts.push('<span style="color:#2E7D32;">👷 '+esc(wLabel(ord.worker))+': '+totalMaster+'</span>');
    if (totalMain > 0) parts.push('<span style="color:#1565C0;">📦 LipoLand: '+totalMain+'</span>');
    if (totalShortage > 0) parts.push('<span style="color:#C62828;">❌ не вистачає: '+totalShortage+'</span>');
    // Add fulfillment stock hint
    plan.forEach(function(p) {
      if (p.productId) {
        var prod = db.products.find(function(x){return x.id===p.productId});
        if (prod && prod.fulfillment) {
          var ffParts = [];
          Object.keys(prod.fulfillment).forEach(function(loc) {
            if (prod.fulfillment[loc] > 0) ffParts.push(loc+': '+prod.fulfillment[loc]);
          });
          if (ffParts.length) parts.push('<span style="color:#7B1FA2;">🏬 '+ffParts.join(', ')+'</span>');
        }
      }
    });
    return parts.length ? parts.join(' • ') : '<span class="text-muted">—</span>';
  }
  
  // Збираємо список джерел для позиції замовлення з залишками
  function gatherShipmentSources(db, ord, item) {
    var sources = []; // { key, label, available, type, location?, wsId? }
    var p = (db.products||[]).find(function(x){ return x.id === item.productId; });
    if (!p) return sources;
    if ((p.stock||0) > 0) sources.push({ key:'main', label:'📦 Мій склад', available:p.stock||0, type:'main' });
    if (ord.worker) {
      var ws = (db.workerStock||[]).find(function(s){ return s.worker===ord.worker && s.itemId===item.productId && s.type==='product'; });
      if (ws && ws.qty > 0) sources.push({ key:'worker', label:'👷 '+wLabel(ord.worker), available:ws.qty, type:'worker', wsId:ws.id });
    }
    if (p.fulfillment) {
      Object.keys(p.fulfillment).forEach(function(loc){
        var q = p.fulfillment[loc] || 0;
        if (q > 0) sources.push({ key:'ff:'+loc, label:'🏬 '+loc, available:q, type:'fulfillment', location:loc });
      });
    }
    return sources;
  }
  
  function shipOrderFromStock(id) {
    var db = getDB();
    var ord = db.orders.find(function(x){return x.id===id});
    if (!ord) return;
    if (ord.shipped) {
      alert('Замовлення вже відвантажене. Спочатку скасуйте відправку.');
      return;
    }
    if (!ord.items || !ord.items.length) { alert('У замовленні немає товарів.'); return; }
  
    // Перевіряємо чи всі позиції привʼязані до товару
    var unlinked = ord.items.filter(function(i){ return !i.productId; });
    if (unlinked.length) {
      alert('⚠ У замовленні '+unlinked.length+' позиц. без прив\'язки до товару.\nНатисни ✏️ біля замовлення і обери товар з каталогу для кожної позиції.');
      return;
    }
  
    // Чи всі позиції мають єдине джерело з достатнім залишком?
    var allSingle = true;
    var hasMulti = false;
    ord.items.forEach(function(item){
      var srcs = gatherShipmentSources(db, ord, item);
      var withStock = srcs.filter(function(s){ return s.available > 0; });
      if (withStock.length > 1) { allSingle = false; hasMulti = true; }
      if (withStock.length === 0) allSingle = false;
    });
  
    // Якщо є позиції з кількома складами — показуємо модалку вибору
    if (hasMulti) {
      openPickShipmentModal(ord);
      return;
    }
  
    // Інакше — авто-списання (старий шлях через planOrderShipment)
    var plan = planOrderShipment(db, ord);
    if (!plan.length) { alert('У замовленні немає товарів.'); return; }
  
    var msgParts = [];
    var hasShortage = false;
    var hasAny = false;
    plan.forEach(function(p) {
      var parts = [];
      if (p.fromMaster) { parts.push('👷 '+wLabel(ord.worker)+': '+p.fromMaster); hasAny = true; }
      if (p.fromMain)   { parts.push('📦 LipoLand: '+p.fromMain); hasAny = true; }
      if (p.fromFf) {
        Object.keys(p.fromFf).forEach(function(loc){
          if (p.fromFf[loc] > 0) { parts.push('🏬 '+loc+': '+p.fromFf[loc]); hasAny = true; }
        });
      }
      if (p.shortage)   { parts.push('❌ не вистачає: '+p.shortage); hasShortage = true; }
      if (p.noLink)     { parts.push('⚠ немає прив\'язки до товару — натисни ✏️ біля замовлення'); }
      msgParts.push('• '+p.name+' — '+(parts.join(', ') || '—'));
    });
  
    if (!hasAny && !hasShortage) { alert('Немає чого списати.'); return; }
    // Замовлення відправляємо тільки повністю. Якщо не вистачає — показуємо модалку з опціями.
    if (hasShortage) {
      var shortItems = plan.filter(function(p){ return p.shortage > 0; });
      if (shortItems.length) openShortageActionModal(ord, shortItems);
      return;
    }
  
    if (!db.workerStockHistory) db.workerStockHistory = [];
    var today = new Date().toISOString().slice(0,10);
    ord.shippedFrom = [];
  
    plan.forEach(function(p) {
      if (p.fromMaster > 0 && p.wsId) {
        var ws = db.workerStock.find(function(s){return s.id === p.wsId;});
        if (ws) {
          ws.qty = (ws.qty||0) - p.fromMaster;
          db.workerStockHistory.push({
            id: uid(), worker: ord.worker, type: 'product',
            itemId: p.productId, itemName: p.name, qty: p.fromMaster,
            action: 'відправлено',
            date: today,
            note: 'Замовлення #'+ord.num,
            orderId: ord.id
          });
          if (ws.qty <= 0) db.workerStock = db.workerStock.filter(function(s){return s.id !== ws.id;});
        }
        ord.shippedFrom.push({ source:'worker', worker: ord.worker, productId: p.productId, qty: p.fromMaster, name: p.name });
      }
      if (p.fromMain > 0 && p.product) {
        p.product.stock = (p.product.stock||0) - p.fromMain;
        ord.shippedFrom.push({ source:'main', productId: p.productId, qty: p.fromMain, name: p.name });
      }
      if (p.fromFf && p.product) {
        Object.keys(p.fromFf).forEach(function(loc){
          var qty = p.fromFf[loc] || 0;
          if (qty <= 0) return;
          if (!p.product.fulfillment) p.product.fulfillment = {};
          p.product.fulfillment[loc] = Math.max(0, (p.product.fulfillment[loc]||0) - qty);
          ord.shippedFrom.push({ source:'fulfillment', location: loc, productId: p.productId, qty: qty, name: p.name });
        });
      }
    });
  
    ord.shipped = true;
    ord.shippedDate = today;
    logAudit(db, 'order', ord.id, 'ship', { num: ord.num, client: ord.client, sourcesCount: (ord.shippedFrom||[]).length, total: ord.total });
    saveDB(db);
    renderPage('orders');
    showUndoToast({
      text: '📤 Замовлення <strong>#'+ord.num+'</strong> відправлено.',
      bg: '#2E7D32',
      onUndo: function(){ unshipOrderSilent(ord.id); return true; }
    });
  }
  
  // ===== CRM SKU mapper =====
  // → винесено в public/js/crm-mapper.js (autoMatchCrmSku, openCrmSkuMapper,
  //   openCrmSkuMapperRefresh, importProductsFromSalesDrive, applyCrmSkuMap)
  // window._crmSkuMapDraft — на window для inline-handlers модалки
  
  
  // ===== Manual multi-source shipment picker =====
  window._pickShipmentCtx = null; // { orderId, items: [{itemIdx, productId, name, need, sources:[...], picks:{key:qty}}] }
  
  function openPickShipmentModal(ord) {
    var db = getDB();
    window._pickShipmentCtx = {
      orderId: ord.id,
      items: ord.items.map(function(item, idx){
        var sources = gatherShipmentSources(db, ord, item);
        // Пре-заповнення: канал = ff-локація → беремо першочергово звідти
        var picks = {};
        var need = item.qty || 0;
        var preferKey = '';
        if (ord.channel) {
          var match = sources.find(function(s){ return s.type==='fulfillment' && s.location.toLowerCase() === String(ord.channel).toLowerCase(); });
          if (match) preferKey = match.key;
        }
        if (preferKey) {
          var s = sources.find(function(x){ return x.key===preferKey; });
          if (s) {
            var t = Math.min(need, s.available);
            picks[s.key] = t;
            need -= t;
          }
        }
        // Якщо лишилось — беремо з worker → main → інші ff
        var order = ['worker','main','fulfillment'];
        order.forEach(function(typ){
          if (need <= 0) return;
          sources.forEach(function(s){
            if (need <= 0) return;
            if (s.type !== typ) return;
            if (picks[s.key]) return;
            var t = Math.min(need, s.available);
            if (t > 0) { picks[s.key] = t; need -= t; }
          });
        });
        return {
          itemIdx: idx,
          productId: item.productId,
          name: item.name,
          sku: item.sku || '',
          need: item.qty || 0,
          sources: sources,
          picks: picks
        };
      })
    };
    renderPickShipmentBody();
    openModal('pick-shipment');
  }
  
  function renderPickShipmentBody() {
    var ctx = window._pickShipmentCtx;
    if (!ctx) return;
    var html = '<p style="font-size:13px;color:var(--text-light);margin-bottom:16px;">У товарів декілька складів. Вкажи скільки звідки списати. Сума має дорівнювати потрібній кількості.</p>';
  
    // Банер: чи є позиції які треба виготовити
    var lacking = ctx.items.filter(function(it){
      var sum = 0;
      Object.keys(it.picks).forEach(function(k){ sum += it.picks[k]||0; });
      return sum < it.need;
    });
    if (lacking.length > 0) {
      html += '<div style="background:#FFF3E0;border:1px solid #FFE0B2;border-radius:10px;padding:12px;margin-bottom:14px;display:flex;align-items:center;gap:12px;justify-content:space-between;flex-wrap:wrap;">'+
        '<div style="font-size:13px;line-height:1.4;">⚠ '+lacking.length+' '+(lacking.length>1?'позиц.':'позиція')+' не вистачає на складі. Запустимо у виробництво?</div>'+
        '<button class="btn btn-warning btn-sm" onclick="goToShortageFromPickShipment()" style="background:#E65100;color:#fff;border:none;padding:8px 14px;border-radius:8px;cursor:pointer;font-weight:600;">🛠 Виготовити цю позицію</button>'+
      '</div>';
    }
  
    ctx.items.forEach(function(it, idx){
      var totalPicked = 0;
      Object.keys(it.picks).forEach(function(k){ totalPicked += it.picks[k]||0; });
      var diff = it.need - totalPicked;
      var statusColor = diff === 0 ? '#2E7D32' : (diff > 0 ? '#C62828' : '#E65100');
      var statusText = diff === 0 ? '✓ ОК' : (diff > 0 ? '⚠ ще треба '+diff : '⚠ забагато на '+(-diff));
  
      html += '<div style="border:1px solid var(--border);border-radius:12px;padding:14px;margin-bottom:12px;background:#fafafa;">';
      html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">';
      html += '<strong>'+(it.sku?'<code>'+esc(it.sku)+'</code> ':'')+esc(it.name)+'</strong>';
      html += '<span style="font-size:13px;color:'+statusColor+';font-weight:600;">Треба: '+it.need+' • Вибрано: '+totalPicked+' • '+statusText+'</span>';
      html += '</div>';
  
      if (!it.sources.length) {
        html += '<div style="color:#C62828;font-size:13px;">❌ Немає на жодному складі</div>';
      } else {
        html += '<div style="display:grid;grid-template-columns:1fr auto auto;gap:8px;align-items:center;">';
        it.sources.forEach(function(s){
          var picked = it.picks[s.key] || 0;
          html += '<div style="font-size:14px;">'+s.label+'</div>';
          html += '<div style="font-size:12px;color:var(--text-light);min-width:100px;text-align:right;">залишок: <strong>'+s.available+'</strong></div>';
          html += '<input type="number" min="0" max="'+s.available+'" value="'+picked+'" style="width:80px;padding:6px;text-align:center;" '+
                  'onchange="updatePickQty('+idx+',\''+s.key+'\',this.value)">';
        });
        html += '</div>';
      }
      html += '</div>';
    });
  
    document.getElementById('pick-shipment-body').innerHTML = html;
    // Validate confirm button
    var allOk = ctx.items.every(function(it){
      var sum = 0;
      Object.keys(it.picks).forEach(function(k){ sum += it.picks[k]||0; });
      return sum === it.need || (sum < it.need && it.sources.length===0);
    });
    var btn = document.getElementById('pick-shipment-confirm');
    if (btn) btn.disabled = !allOk;
  }
  
  function goToShortageFromPickShipment() {
    var ctx = window._pickShipmentCtx;
    if (!ctx) return;
    var db = getDB();
    var ord = db.orders.find(function(x){ return x.id === ctx.orderId; });
    if (!ord) return;
    // Збираємо позиції з нестачею
    var shortItems = [];
    ctx.items.forEach(function(it){
      var sum = 0;
      Object.keys(it.picks).forEach(function(k){ sum += it.picks[k]||0; });
      var lack = Math.max(0, it.need - sum);
      if (lack > 0) shortItems.push({ productId: it.productId, shortage: lack, name: it.name });
    });
    if (!shortItems.length) return;
    closeModal('pick-shipment');
    window._pickShipmentCtx = null;
    openShortageActionModal(ord, shortItems);
  }
  
  function updatePickQty(itemIdx, srcKey, val) {
    var ctx = window._pickShipmentCtx;
    if (!ctx) return;
    var it = ctx.items[itemIdx];
    if (!it) return;
    var src = it.sources.find(function(s){ return s.key===srcKey; });
    var n = Math.max(0, parseInt(val)||0);
    if (src && n > src.available) n = src.available;
    it.picks[srcKey] = n;
    renderPickShipmentBody();
  }
  
  function confirmPickShipment() {
    var ctx = window._pickShipmentCtx;
    if (!ctx) return;
    var db = getDB();
    var ord = db.orders.find(function(x){ return x.id === ctx.orderId; });
    if (!ord) { closeModal('pick-shipment'); return; }
  
    // Валідація: відправляємо тільки повністю
    // Збираємо позиції з нестачею для пропозиції виробництва
    var shortItems = [];
    ctx.items.forEach(function(it){
      var sum = 0;
      Object.keys(it.picks).forEach(function(k){ sum += it.picks[k]||0; });
      var lack = Math.max(0, it.need - sum);
      if (lack > 0) shortItems.push({ productId: it.productId, shortage: lack, name: it.name });
    });
    if (shortItems.length > 0) {
      closeModal('pick-shipment');
      window._pickShipmentCtx = null;
      openShortageActionModal(ord, shortItems);
      return;
    }
  
    if (!db.workerStockHistory) db.workerStockHistory = [];
    var today = new Date().toISOString().slice(0,10);
    ord.shippedFrom = [];
  
    ctx.items.forEach(function(it){
      it.sources.forEach(function(s){
        var qty = it.picks[s.key] || 0;
        if (qty <= 0) return;
        if (s.type === 'main') {
          var p = db.products.find(function(x){ return x.id === it.productId; });
          if (p) p.stock = Math.max(0, (p.stock||0) - qty);
          ord.shippedFrom.push({ source:'main', productId: it.productId, qty: qty, name: it.name });
        } else if (s.type === 'worker') {
          var ws = db.workerStock.find(function(w){ return w.id === s.wsId; });
          if (ws) {
            ws.qty = Math.max(0, (ws.qty||0) - qty);
            db.workerStockHistory.push({
              id: uid(), worker: ord.worker, type:'product',
              itemId: it.productId, itemName: it.name, qty: qty,
              action:'відправлено', date: today,
              note:'Замовлення #'+ord.num, orderId: ord.id
            });
            if (ws.qty <= 0) db.workerStock = db.workerStock.filter(function(x){ return x.id !== ws.id; });
          }
          ord.shippedFrom.push({ source:'worker', worker: ord.worker, productId: it.productId, qty: qty, name: it.name });
        } else if (s.type === 'fulfillment') {
          var p2 = db.products.find(function(x){ return x.id === it.productId; });
          if (p2) {
            if (!p2.fulfillment) p2.fulfillment = {};
            p2.fulfillment[s.location] = Math.max(0, (p2.fulfillment[s.location]||0) - qty);
          }
          ord.shippedFrom.push({ source:'fulfillment', location: s.location, productId: it.productId, qty: qty, name: it.name });
        }
      });
    });
  
    ord.shipped = true;
    ord.shippedDate = today;
    logAudit(db, 'order', ord.id, 'ship', { num: ord.num, client: ord.client, sourcesCount: (ord.shippedFrom||[]).length, total: ord.total, manual: true });
    saveDB(db);
    closeModal('pick-shipment');
    window._pickShipmentCtx = null;
    renderPage('orders');
    showUndoToast({
      text: '📤 Замовлення <strong>#'+ord.num+'</strong> відправлено.',
      bg: '#2E7D32',
      onUndo: function(){ unshipOrderSilent(ord.id); return true; }
    });
  }
  
  function unshipOrderSilent(id) {
    return unshipOrderImpl(id, true);
  }
  
  function unshipOrder(id) {
    return unshipOrderImpl(id, false);
  }
  
  function unshipOrderImpl(id, silent) {
    var db = getDB();
    var ord = db.orders.find(function(x){return x.id===id});
    if (!ord || !ord.shipped) return;
    if (!silent && !confirm('Повернути товари на склад і скасувати відправку замовлення #'+ord.num+'?')) return;
  
    if (!db.workerStockHistory) db.workerStockHistory = [];
    var today = new Date().toISOString().slice(0,10);
  
    (ord.shippedFrom || []).forEach(function(s) {
      if (s.source === 'main') {
        var p = (db.products||[]).find(function(x){return x.id===s.productId;});
        if (p) p.stock = (p.stock||0) + s.qty;
      } else if (s.source === 'fulfillment') {
        var p = (db.products||[]).find(function(x){return x.id===s.productId;});
        if (p) {
          if (!p.fulfillment) p.fulfillment = {};
          p.fulfillment[s.location] = (p.fulfillment[s.location]||0) + s.qty;
        }
      } else if (s.source === 'worker') {
        if (!db.workerStock) db.workerStock = [];
        var ws = db.workerStock.find(function(w){
          return w.worker===s.worker && w.itemId===s.productId && w.type==='product';
        });
        if (ws) {
          ws.qty = (ws.qty||0) + s.qty;
        } else {
          db.workerStock.push({
            id: uid(), worker: s.worker, type: 'product',
            itemId: s.productId, itemName: s.name || 'Товар',
            qty: s.qty, date: today,
            note: 'повернуто з замовлення #'+ord.num
          });
        }
        db.workerStockHistory.push({
          id: uid(), worker: s.worker, type: 'product',
          itemId: s.productId, itemName: s.name || 'Товар', qty: s.qty,
          action: 'повернуто (скасовано відправку)',
          date: today, note: 'Замовлення #'+ord.num, orderId: ord.id
        });
      }
    });
  
    ord.shipped = false;
    ord.shippedFrom = [];
    ord.shippedDate = null;
    logAudit(db, 'order', ord.id, 'unship', { num: ord.num, client: ord.client, silent: !!silent });
    saveDB(db);
    renderPage('orders');
  }

  // Експорт — window._pickShipmentCtx на window для inline-handlers модалки
  window.planOrderShipment = planOrderShipment;
  window.orderStockHint = orderStockHint;
  window.gatherShipmentSources = gatherShipmentSources;
  window.shipOrderFromStock = shipOrderFromStock;
  window.openPickShipmentModal = openPickShipmentModal;
  window.renderPickShipmentBody = renderPickShipmentBody;
  window.goToShortageFromPickShipment = goToShortageFromPickShipment;
  window.updatePickQty = updatePickQty;
  window.confirmPickShipment = confirmPickShipment;
  window.unshipOrderSilent = unshipOrderSilent;
  window.unshipOrder = unshipOrder;
  window.unshipOrderImpl = unshipOrderImpl;
})();
