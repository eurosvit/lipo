// ============================================================
// LipoLand — Order inline-actions module
// ============================================================
// Інлайн-редагування полів замовлення прямо в таблиці:
// TTN, ціна позиції, ціна товару, нотатка + setOrderPayment{Type,Status}.

(function(){
  'use strict';

  function inlineEditTtn(td, orderId, currentVal) {
    // Prevent double-click creating multiple inputs
    if (td.querySelector('input')) return;
    var input = document.createElement('input');
    input.type = 'text';
    input.value = currentVal;
    input.placeholder = 'Введіть ТТН...';
    input.style.cssText = 'width:100%;font-size:12px;font-family:monospace;padding:4px 8px;border:2px solid var(--primary);border-radius:6px;outline:none;background:#FAFAFE;';
    input.maxLength = 30;
    td.innerHTML = '';
    td.appendChild(input);
    input.focus();
    input.select();
  
    function save() {
      var val = input.value.trim();
      var db = getDB();
      var ord = db.orders.find(function(x){return x.id===orderId});
      if (ord) {
        ord.ttn = val;
        // Auto-set carrier if looks like NP
        if (/^\d{14}$/.test(val) && !ord.carrier) ord.carrier = 'nova';
        // Clear old tracking if TTN changed
        if (val !== currentVal) ord.tracking = null;
        saveDB(db);
      }
      renderOrders();
      // Auto-track if new TTN was entered
      if (val && val !== currentVal && typeof trackNpOrders === 'function') {
        setTimeout(function(){ trackNpOrders({force:true}); }, 500);
      }
    }
  
    input.addEventListener('keydown', function(e) {
      if (e.key === 'Enter') { e.preventDefault(); save(); }
      if (e.key === 'Escape') { renderOrders(); }
    });
    input.addEventListener('blur', save);
  }
  
  // Інлайн-редагування ціни позиції в замовленні (для перерахунку Etsy USD/EUR → UAH і т.п.)
  function inlineEditItemPrice(span, orderId, itemIdx, currentPrice) {
    if (span.querySelector('input')) return;
    var input = document.createElement('input');
    input.type = 'number';
    input.step = '0.01';
    input.min = '0';
    input.value = currentPrice;
    input.style.cssText = 'width:90px;font-size:12px;padding:3px 6px;border:2px solid var(--primary);border-radius:4px;outline:none;background:#FAFAFE;';
    span.innerHTML = '';
    span.appendChild(input);
    input.focus();
    input.select();
  
    function save() {
      var val = parseFloat(input.value);
      if (isNaN(val) || val < 0) { renderOrders(); return; }
      var db = getDB();
      var ord = db.orders.find(function(x){ return x.id === orderId; });
      if (!ord || !ord.items || !ord.items[itemIdx]) { renderOrders(); return; }
      var oldPrice = Number(ord.items[itemIdx].price)||0;
      if (oldPrice === val) { renderOrders(); return; }
      ord.items[itemIdx].price = val;
      ord.total = ord.items.reduce(function(s, i){ return s + (Number(i.price)||0) * (Number(i.qty)||0); }, 0);
      logAudit(db, 'order', ord.id, 'price_change', { num: ord.num, item: ord.items[itemIdx].name, oldPrice: oldPrice, newPrice: val, newTotal: ord.total });
      saveDB(db);
      renderOrders();
    }
  
    input.addEventListener('keydown', function(e) {
      if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
      if (e.key === 'Escape') { renderOrders(); }
    });
    input.addEventListener('blur', save);
  }
  
  function inlineEditProductPrice(td, productId, currentPrice) {
    if (td.querySelector('input')) return;
    var input = document.createElement('input');
    input.type = 'number';
    input.step = '0.01';
    input.min = '0';
    input.value = currentPrice;
    input.style.cssText = 'width:90px;font-size:13px;padding:4px 6px;border:2px solid var(--primary);border-radius:4px;outline:none;background:#FAFAFE;';
    td.innerHTML = '';
    td.appendChild(input);
    input.focus();
    input.select();
  
    function save() {
      var val = parseFloat(input.value);
      if (isNaN(val) || val < 0) { renderProducts(); return; }
      var db = getDB();
      var p = db.products.find(function(x){ return x.id === productId; });
      if (!p) { renderProducts(); return; }
      if (Number(p.sellPrice||0) === val) { renderProducts(); return; }
      var oldPrice = Number(p.sellPrice||0);
      p.sellPrice = val;
      logAudit(db, 'product', p.id, 'price_change', { sku: p.sku, name: p.name, oldPrice: oldPrice, newPrice: val });
      saveDB(db);
      renderProducts();
    }
  
    input.addEventListener('keydown', function(e) {
      if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
      if (e.key === 'Escape') { renderProducts(); }
    });
    input.addEventListener('blur', save);
  }
  
  function setOrderPaymentType(id, val) {
    var db = getDB();
    var ord = db.orders.find(function(x){return x.id===id});
    if(ord) { ord.paymentType = val; saveDB(db); renderPage('orders'); }
  }
  
  function setOrderPaymentStatus(id, val) {
    var db = getDB();
    var ord = db.orders.find(function(x){return x.id===id});
    if(ord) { ord.paymentStatus = val; saveDB(db); renderPage('orders'); }
  }
  
  function inlineEditNote(td, orderId, currentVal) {
    if (td.querySelector('textarea')) return;
    var ta = document.createElement('textarea');
    ta.value = currentVal.replace(/\\n/g, '\n');
    ta.placeholder = 'Нотатка...';
    ta.rows = 2;
    ta.style.cssText = 'width:100%;font-size:12px;padding:4px 8px;border:2px solid var(--primary);border-radius:6px;outline:none;resize:vertical;min-width:150px;';
    td.innerHTML = '';
    td.appendChild(ta);
    ta.focus();
    function save() {
      var val = ta.value.trim();
      var db = getDB();
      var ord = db.orders.find(function(x){return x.id===orderId});
      if (ord) { ord.note = val; saveDB(db); }
      renderOrders();
    }
    ta.addEventListener('keydown', function(e) {
      if (e.key === 'Escape') renderOrders();
    });
    ta.addEventListener('blur', save);
  }

  window.inlineEditTtn = inlineEditTtn;
  window.inlineEditItemPrice = inlineEditItemPrice;
  window.inlineEditProductPrice = inlineEditProductPrice;
  window.setOrderPaymentType = setOrderPaymentType;
  window.setOrderPaymentStatus = setOrderPaymentStatus;
  window.inlineEditNote = inlineEditNote;
})();
