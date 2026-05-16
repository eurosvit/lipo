// ============================================================
// LipoLand — Returns / refusal / defect module
// ============================================================
// Логіка повернення замовлення в склад + детекція "return-статусів"
// (returned/cancelled/відмова/тощо). Виклики з основного script:
// - setOrderStatus → statusMeansReturn + auto-trigger returnOrderToStock
// - кнопка 📦↩ → returnOrderToStock

(function(){
  'use strict';

  // Статуси, при переході на які треба авто-повертати товар на склад.
  // Матчимо по id І по label (lowercase) — щоб ловити користувацькі статуси
  // типу 'відмова', 'cancelled', 'скасовано', не лише дефолтний 'returned'.
  function statusMeansReturn(statusObj) {
    if (!statusObj) return false;
    var id = String(statusObj.id||'').toLowerCase();
    var label = String(statusObj.label||'').toLowerCase();
    var keys = ['return', 'cancel', 'refus', 'відмов', 'поверн', 'скасов'];
    return keys.some(function(k){ return id.indexOf(k) !== -1 || label.indexOf(k) !== -1; });
  }

  // Повернення замовлення в склад. Розрізняє два сценарії:
  // 1. Замовлення було ВІДПРАВЛЕНЕ (o.shipped=true, o.shippedFrom є) —
  //    повертаємо в ті самі джерела звідки пішло (worker/main/fulfillment).
  // 2. Замовлення НЕ відправлене — товар зі складу не списувався,
  //    тому нічого повертати не треба (просто маркуємо як скасоване).
  // Опційно: «брак» — товар фізично втрачено, не повертати на склад,
  //    лише запис у db.defects для трекінгу.
  function returnOrderToStock(id, opts) {
    opts = opts || {};
    var db = getDB();
    var o = db.orders.find(function(x){return x.id===id});
    if (!o) return;
    if (o.returnedToStock) {
      if (!opts.silent) alert('Це замовлення вже позначене як повернене.');
      return;
    }
    var reason = opts.reason;
    var asDefect = !!opts.asDefect;
    if (!opts.silent && reason === undefined) {
      var defaultReason = o.status === 'returned' ? 'Клієнт повернув' : 'Клієнт відмовився від замовлення';
      var inp = prompt('Причина повернення/відмови:\n(Enter — без причини; додай "БРАК" на початку якщо товар не повертається на склад)', defaultReason);
      if (inp === null) return;
      reason = inp.trim();
      if (/^брак\b/i.test(reason)) {
        asDefect = true;
      }
    }

    var itemsList = (o.items||[]).map(function(it){
      var p = db.products.find(function(x){return x.id===it.productId});
      return (p ? p.name : '?') + ' × ' + it.qty;
    }).join('\n');

    var today = new Date().toISOString().slice(0,10);

    if (o.shipped && Array.isArray(o.shippedFrom) && o.shippedFrom.length) {
      if (!opts.silent) {
        var modeLbl = asDefect ? '🚫 БРАК (не повертати на склад, тільки запис)' : '📦↩ Повернути в ті ж джерела (склад/майстер/фулфілмент)';
        if (!confirm('Повернути замовлення #'+o.num+'?\n\n'+itemsList+'\n\nРежим: '+modeLbl+'\nПричина: '+(reason||'—'))) return;
      }
      if (!asDefect) {
        if (!db.workerStockHistory) db.workerStockHistory = [];
        o.shippedFrom.forEach(function(s){
          if (s.source === 'main') {
            var p = (db.products||[]).find(function(x){return x.id===s.productId;});
            if (p) p.stock = (p.stock||0) + s.qty;
          } else if (s.source === 'fulfillment') {
            var p2 = (db.products||[]).find(function(x){return x.id===s.productId;});
            if (p2) {
              if (!p2.fulfillment) p2.fulfillment = {};
              p2.fulfillment[s.location] = (p2.fulfillment[s.location]||0) + s.qty;
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
                note: 'повернуто з замовлення #'+o.num+(reason?' ('+reason+')':'')
              });
            }
            db.workerStockHistory.push({
              id: uid(), worker: s.worker, type: 'product',
              itemId: s.productId, itemName: s.name || 'Товар', qty: s.qty,
              action: 'повернуто (відмова клієнта)',
              date: today, note: 'Замовлення #'+o.num+(reason?'. '+reason:''), orderId: o.id
            });
          }
        });
      }
    } else {
      if (!opts.silent) {
        if (!confirm('Замовлення #'+o.num+' не було відправлене — товар на складі не змінювався.\n\nПросто позначити як скасоване?\n\n'+itemsList+'\n\nПричина: '+(reason||'—'))) return;
      }
    }

    if (asDefect && o.items && o.items.length) {
      if (!db.defects) db.defects = [];
      o.items.forEach(function(it){
        db.defects.push({
          id: uid(), date: today, orderId: o.id, orderNum: o.num,
          productId: it.productId || null,
          productName: it.name || '?', sku: it.sku || '',
          qty: it.qty || 0, reason: reason || 'брак',
          clientName: o.client || ((o.firstName||'')+' '+(o.lastName||'')).trim()
        });
      });
    }

    o.returnedToStock = true;
    o.returnDate = today;
    o.returnReason = reason || '';
    o.returnAsDefect = asDefect;
    if (typeof logAudit === 'function') {
      logAudit(db, 'order', o.id, 'return', { num: o.num, client: o.client, reason: reason||'', asDefect: asDefect, itemsCount: (o.items||[]).length });
    }
    saveDB(db);
    renderPage('orders');
    if (!opts.silent) {
      var msg = asDefect
        ? '🚫 Замовлення #'+o.num+' позначене як БРАК. На склад НЕ повернуто. Записи в журналі браку.'
        : (o.shipped ? '📦↩ Товар з замовлення #'+o.num+' повернено в джерела (склад/майстер/фулфілмент).' : '✓ Замовлення #'+o.num+' позначене як скасоване (склад не змінювався).');
      alert(msg);
    }
  }

  window.statusMeansReturn = statusMeansReturn;
  window.returnOrderToStock = returnOrderToStock;
})();
