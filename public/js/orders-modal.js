// ============================================================
// LipoLand — Edit Order Modal module
// ============================================================
// openEditOrder + saveOrderEdit + items editor (window._eordItems на window).
// Захист від stock-loss: items НЕ перезаписуються якщо o.shipped=true.

(function(){
  'use strict';

  function openEditOrder(id) {
    var db = getDB();
    var o = db.orders.find(function(x){ return x.id === id; });
    if (!o) return;
    populateOrderChannelSelect('eord-channel');
    document.getElementById('eord-id').value = o.id;
    document.getElementById('eord-first-name').value = o.firstName || '';
    document.getElementById('eord-last-name').value = o.lastName || '';
    // Backward compat: if no first/last but there's "client" — split once
    if (!o.firstName && !o.lastName && o.client) {
      var parts = String(o.client).trim().split(/\s+/);
      document.getElementById('eord-first-name').value = parts[0] || '';
      document.getElementById('eord-last-name').value = parts.slice(1).join(' ') || '';
    }
    document.getElementById('eord-phone').value = o.phone || '';
    document.getElementById('eord-email').value = o.email || '';
    document.getElementById('eord-carrier').value = o.carrier || '';
    document.getElementById('eord-city').value = o.city || '';
    document.getElementById('eord-warehouse').value = o.warehouse || '';
    document.getElementById('eord-address').value = o.address || '';
    document.getElementById('eord-ttn').value = o.ttn || '';
    var scEl = document.getElementById('eord-shipping-cost');
    if (scEl) scEl.value = (o.shippingCost > 0) ? o.shippingCost : '';
    document.getElementById('eord-payment').value = o.paymentType || '';
    document.getElementById('eord-payment-status').value = o.paymentStatus || 'unpaid';
    document.getElementById('eord-date').value = o.date || '';
    document.getElementById('eord-channel').value = o.channel || '';
    document.getElementById('eord-comment').value = o.comment || '';
    toggleOrdDeliveryFields('eord');
    // Items
    window._eordItems = (o.items || []).map(function(it){
      return {
        productId: it.productId || '',
        name: it.name || '',
        sku: it.sku || '',
        qty: it.qty || 1,
        price: it.price || 0,
        worker: it.worker || ''
      };
    });
    if (!window._eordItems.length) window._eordItems.push({ productId:'', name:'', sku:'', qty:1, price:0, worker:'' });
    renderEordItems();
    document.getElementById('modal-edit-order').classList.add('show');
  }
  
  window._eordItems = [];
  
  function renderEordItems() {
    var workerNames = (typeof getAllWorkerNames === 'function') ? getAllWorkerNames() : [];
    var html = window._eordItems.map(function(it, idx){
      var unlinked = !it.productId;
      var warn = unlinked ? '<div style="font-size:11px;color:#C62828;margin-top:4px;">⚠ Не привʼязано до товару — без цього не можна списати зі складу</div>' : '';
      var origLine = unlinked && it.name ? '<div style="font-size:11px;color:var(--text-light);margin-top:4px;">Текст із CRM: <em>'+esc(it.name)+'</em></div>' : '';
      var displayVal = it.productId ? ((it.sku?it.sku+' — ':'') + (it.name||'')) : '';
      var workerOpts = '<option value="">— як у замовл. —</option>' + workerNames.map(function(w){
        return '<option value="'+esc(w)+'" '+(it.worker===w?'selected':'')+'>'+esc(typeof wLabel==='function'?wLabel(w):w)+'</option>';
      }).join('');
      return '<div style="border:1px solid '+(unlinked?'#FFCDD2':'var(--border)')+';border-radius:10px;padding:12px;background:'+(unlinked?'#FFF8F8':'#fafafa')+';">'+
        '<div class="form-row" style="margin-bottom:8px;">'+
          '<div class="form-group" style="flex:2;position:relative;"><label>Товар з каталогу</label>'+
            '<input type="text" id="eord-search-'+idx+'" autocomplete="off" placeholder="Пошук: SKU або назва..." value="'+esc(displayVal)+'" '+
              'oninput="filterEordProducts('+idx+')" onfocus="filterEordProducts('+idx+')" '+
              'onblur="setTimeout(function(){var d=document.getElementById(\'eord-dd-'+idx+'\');if(d)d.style.display=\'none\';},200)" style="width:100%;">'+
            '<div id="eord-dd-'+idx+'" style="display:none;position:absolute;left:0;right:0;top:100%;background:#fff;border:1px solid var(--border);border-radius:8px;max-height:240px;overflow-y:auto;z-index:200;box-shadow:0 4px 12px rgba(0,0,0,0.15);"></div>'+
          '</div>'+
          '<div class="form-group" style="flex:0 0 80px;"><label>К-сть</label>'+
            '<input type="number" min="1" value="'+it.qty+'" onchange="updateEordItem('+idx+',\'qty\',this)">'+
          '</div>'+
          '<div class="form-group" style="flex:0 0 100px;"><label>Ціна</label>'+
            '<input type="number" step="0.01" value="'+it.price+'" onchange="updateEordItem('+idx+',\'price\',this)">'+
          '</div>'+
          '<div class="form-group" style="flex:0 0 40px;align-self:flex-end;">'+
            '<button class="btn btn-danger btn-sm" onclick="removeEordItem('+idx+')" title="Видалити">&#x1F5D1;</button>'+
          '</div>'+
        '</div>'+
        '<div class="form-row" style="margin-top:0;">'+
          '<div class="form-group" style="flex:1;"><label style="font-size:11px;">👷 Майстер цієї позиції</label>'+
            '<select onchange="updateEordItem('+idx+',\'worker\',this)">'+workerOpts+'</select>'+
          '</div>'+
        '</div>'+
        origLine + warn +
      '</div>';
    }).join('');
    document.getElementById('eord-items').innerHTML = html;
  }
  
  function filterEordProducts(idx) {
    var input = document.getElementById('eord-search-'+idx);
    var dd = document.getElementById('eord-dd-'+idx);
    if (!input || !dd) return;
    var q = input.value.toLowerCase().trim();
    var db = getDB();
    var prods = (db.products||[]).filter(function(p){ return p.active!==false; });
    var matched = prods.filter(function(p){
      if (!q) return true;
      return (p.sku||'').toLowerCase().indexOf(q) !== -1 || (p.name||'').toLowerCase().indexOf(q) !== -1;
    }).slice(0, 30);
    if (!matched.length) {
      dd.innerHTML = '<div style="padding:10px;color:var(--text-light);font-size:13px;">Нічого не знайдено</div>';
    } else {
      dd.innerHTML = matched.map(function(p){
        var stockColor = (p.stock||0) > 0 ? '#2E7D32' : '#999';
        return '<div style="padding:8px 12px;cursor:pointer;border-bottom:1px solid #f0f0f0;" '+
          'onmousedown="selectEordProduct('+idx+',\''+p.id+'\')" '+
          'onmouseover="this.style.background=\'#f5f5f5\'" onmouseout="this.style.background=\'\'">'+
          '<div style="font-size:13px;">'+(p.sku?'<code style="font-size:11px;color:#666;">'+esc(p.sku)+'</code> ':'')+esc(p.name)+'</div>'+
          '<div style="font-size:11px;color:'+stockColor+';">на складі: '+(p.stock||0)+' шт • '+fmt(p.sellPrice||0)+' грн</div>'+
        '</div>';
      }).join('');
    }
    dd.style.display = 'block';
  }
  
  function selectEordProduct(idx, productId) {
    var db = getDB();
    var p = db.products.find(function(x){ return x.id === productId; });
    if (!p) return;
    var it = window._eordItems[idx];
    if (!it) return;
    it.productId = productId;
    it.sku = p.sku || '';
    it.name = p.name || '';
    if (!it.price || it.price === 0) it.price = p.sellPrice || 0;
    renderEordItems();
  }
  
  function updateEordItem(idx, field, el) {
    var it = window._eordItems[idx];
    if (!it) return;
    if (field === 'qty') {
      it.qty = Math.max(1, parseInt(el.value)||1);
    } else if (field === 'price') {
      it.price = parseFloat(el.value)||0;
    } else if (field === 'worker') {
      it.worker = el.value || '';
    }
  }
  
  function addEordItem() {
    window._eordItems.push({ productId:'', name:'', sku:'', qty:1, price:0, worker:'' });
    renderEordItems();
  }
  
  function removeEordItem(idx) {
    if (window._eordItems.length === 1) {
      window._eordItems[0] = { productId:'', name:'', sku:'', qty:1, price:0, worker:'' };
    } else {
      window._eordItems.splice(idx, 1);
    }
    renderEordItems();
  }
  
  function saveOrderEdit() {
    var db = getDB();
    var id = document.getElementById('eord-id').value;
    var o = db.orders.find(function(x){ return x.id === id; });
    if (!o) { alert('Замовлення не знайдено'); return; }
  
    // Build new items from edit state
    var newItems = window._eordItems.filter(function(it){ return (it.productId || it.name) && it.qty > 0; }).map(function(it){
      return { productId: it.productId || null, name: it.name || '', sku: it.sku || '', qty: it.qty || 1, price: it.price || 0, worker: it.worker || '' };
    });
  
    // GUARD: shipped orders cannot have items/qty changed silently — would lose stock.
    // shippedFrom records the source (worker/main/fulfillment) of every shipped unit.
    // If qty drops 5→1 on a shipped order, the 4 difference must be returned to its source.
    // We don't do that auto-return here; instead we force user to "unship → edit → re-ship"
    // (which correctly reconciles stock via unshipOrder).
    var blockItemsUpdate = false;
    if (o.shipped) {
      var oldItems = o.items || [];
      var sameItems = oldItems.length === newItems.length;
      if (sameItems) {
        for (var i = 0; i < newItems.length; i++) {
          var oi = oldItems[i] || {};
          var ni = newItems[i];
          if ((oi.productId||null) !== (ni.productId||null) || Number(oi.qty||0) !== Number(ni.qty||0)) {
            sameItems = false; break;
          }
        }
      }
      if (!sameItems) {
        alert('⚠ Замовлення вже відправлено — кількість і товари НЕ ЗМІНЕНО.\n\nІнакше товари «загубляться» зі складу, бо різницю нікуди не повернути.\n\nЩоб виправити:\n1) Натисни ✅ біля замовлення в списку (скасувати відправку — товари повернуться на склад/майстру)\n2) Тоді ✏️ → редагуй кількість/товари\n3) Відправ замовлення заново\n\nІнші поля (клієнт, адреса, оплата, ТТН, коментар) — збережено.');
        blockItemsUpdate = true;
      }
    }
  
    o.firstName = v('eord-first-name').trim();
    o.lastName = v('eord-last-name').trim();
    o.client = (o.firstName + ' ' + o.lastName).trim() || o.client || '';
    o.phone = v('eord-phone').trim();
    o.email = v('eord-email').trim();
    o.carrier = v('eord-carrier');
    o.city = v('eord-city').trim();
    o.warehouse = v('eord-warehouse').trim();
    o.address = v('eord-address').trim();
    o.ttn = v('eord-ttn').trim();
    o.shippingCost = parseFloat(v('eord-shipping-cost')) || 0;
    o.paymentType = v('eord-payment');
    o.paymentStatus = v('eord-payment-status');
    o.date = v('eord-date') || o.date;
    o.channel = v('eord-channel');
    o.comment = v('eord-comment').trim();
    // Items — only apply if not blocked (shipped order)
    if (!blockItemsUpdate && newItems.length) {
      o.items = newItems;
      o.total = newItems.reduce(function(s,i){ return s + (i.price||0)*(i.qty||0); }, 0);
    }
    logAudit(db, 'order', o.id, 'edit', { num: o.num, client: o.client, itemsCount: (o.items||[]).length, total: o.total, blockedItems: blockItemsUpdate });
    saveDB(db);
    closeModal('edit-order');
    renderPage('orders');
  }

  window.openEditOrder = openEditOrder;
  window.renderEordItems = renderEordItems;
  window.filterEordProducts = filterEordProducts;
  window.selectEordProduct = selectEordProduct;
  window.updateEordItem = updateEordItem;
  window.addEordItem = addEordItem;
  window.removeEordItem = removeEordItem;
  window.saveOrderEdit = saveOrderEdit;
})();
