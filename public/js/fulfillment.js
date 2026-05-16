// ============================================================
// LipoLand — Fulfillment module
// ============================================================
// Передача товарів на зовнішні склади (Розетка, Prom, etc.) +
// менеджер локацій. Робота з p.fulfillment[location] = qty.
// Глобали: getDB, saveDB, esc, fmt, openModal, closeModal, renderPage.

(function(){
  'use strict';

  // ==================== FULFILLMENT STOCK ====================
  function openTransferFulfillment(productId) {
    var db = getDB();
    var sel = document.getElementById('tf-product');
    sel.innerHTML = db.products.filter(function(p){return p.active!==false && (p.stock||0)>0}).map(function(p){
      return '<option value="'+p.id+'">'+(p.sku?p.sku+' — ':'')+esc(p.name)+' ('+( p.stock||0)+' шт)</option>';
    }).join('');
    if (productId) sel.value = productId;
  
    var locs = db.fulfillmentLocations || ['Розетка'];
    var locSel = document.getElementById('tf-location');
    locSel.innerHTML = locs.map(function(l){ return '<option value="'+esc(l)+'">'+esc(l)+'</option>'; }).join('');
  
    updateTfMax();
    openModal('transfer-fulfillment');
  }
  
  function updateTfMax() {
    var db = getDB();
    var p = db.products.find(function(x){return x.id===v('tf-product')});
    var avail = p ? (p.stock||0) : 0;
    document.getElementById('tf-qty').max = avail;
    document.getElementById('tf-avail').textContent = 'Доступно на складі: ' + avail + ' шт';
  }
  
  function transferToFulfillment() {
    var db = getDB();
    var productId = v('tf-product');
    var location = v('tf-location');
    var qty = parseInt(v('tf-qty')) || 0;
  
    if (!productId || !location || qty <= 0) return alert('Заповніть всі поля');
  
    var p = db.products.find(function(x){return x.id===productId});
    if (!p) return alert('Гру не знайдено');
    if (qty > (p.stock||0)) return alert('На складі лише ' + (p.stock||0) + ' шт');
  
    // Deduct from main stock
    p.stock = (p.stock||0) - qty;
  
    // Add to fulfillment
    if (!p.fulfillment) p.fulfillment = {};
    p.fulfillment[location] = (p.fulfillment[location]||0) + qty;
  
    saveDB(db);
    closeModal('transfer-fulfillment');
    renderPage('products');
    alert('✅ Передано ' + qty + ' шт на "' + location + '"');
  }
  
  function returnFromFulfillment(productId) {
    var db = getDB();
    var p = db.products.find(function(x){return x.id===productId});
    if (!p || !p.fulfillment) return;
  
    var locs = Object.keys(p.fulfillment).filter(function(k){return p.fulfillment[k]>0});
    if (!locs.length) return alert('На фулфілменті немає товарів');
  
    var loc = locs.length === 1 ? locs[0] : prompt('З якої точки повернути?\n' + locs.map(function(l){return l+': '+p.fulfillment[l]+' шт'}).join('\n'));
    if (!loc || !p.fulfillment[loc]) return;
  
    var max = p.fulfillment[loc];
    var qty = parseInt(prompt('Повернути зі "'+loc+'" (макс '+max+' шт):', max));
    if (!qty || qty <= 0) return;
    if (qty > max) qty = max;
  
    p.fulfillment[loc] -= qty;
    if (p.fulfillment[loc] <= 0) delete p.fulfillment[loc];
    p.stock = (p.stock||0) + qty;
  
    saveDB(db);
    renderPage('products');
  }
  
  // ==================== FULFILLMENT LOCATIONS ====================
  function toggleFfManager() {
    var el = document.getElementById('ff-manager');
    if (!el) return;
    var open = el.style.display !== 'none';
    el.style.display = open ? 'none' : 'block';
    try { localStorage.setItem('lipo_ff_manager_open', open ? '0' : '1'); } catch(e){}
  }
  
  function applyFfManagerState() {
    var el = document.getElementById('ff-manager');
    if (!el) return;
    var saved = '0';
    try { saved = localStorage.getItem('lipo_ff_manager_open') || '0'; } catch(e){}
    el.style.display = saved === '1' ? 'block' : 'none';
  }
  
  function renderFulfillmentLocations() {
    var db = getDB();
    var locs = db.fulfillmentLocations || ['Розетка'];
    var container = document.getElementById('ff-locations-list');
    if (!container) return;
    container.innerHTML = locs.map(function(l) {
      return '<span class="badge badge-ok" style="padding:6px 12px;font-size:13px;">'+esc(l)+
        ' <button onclick="renameFfLocation(\''+esc(l.replace(/'/g,"\\'"))+'\')" style="border:none;background:none;cursor:pointer;font-size:11px;" title="Перейменувати">✏️</button>'+
        ' <button onclick="deleteFfLocation(\''+esc(l.replace(/'/g,"\\'"))+'\')" style="border:none;background:none;cursor:pointer;font-size:11px;color:#c00;" title="Видалити">✕</button>'+
        '</span>';
    }).join(' ');
  }
  
  function addFfLocation() {
    var name = v('new-ff-location').trim();
    if (!name) return;
    var db = getDB();
    if (!db.fulfillmentLocations) db.fulfillmentLocations = ['Розетка'];
    if (db.fulfillmentLocations.indexOf(name) !== -1) return alert('Така точка вже є');
    db.fulfillmentLocations.push(name);
    saveDB(db);
    document.getElementById('new-ff-location').value = '';
    renderFulfillmentLocations();
  }
  
  function renameFfLocation(oldName) {
    var newName = prompt('Нова назва для "'+oldName+'":', oldName);
    if (!newName || newName === oldName) return;
    var db = getDB();
    var idx = (db.fulfillmentLocations||[]).indexOf(oldName);
    if (idx === -1) return;
    db.fulfillmentLocations[idx] = newName;
    // Update all products
    db.products.forEach(function(p) {
      if (p.fulfillment && p.fulfillment[oldName] !== undefined) {
        p.fulfillment[newName] = (p.fulfillment[newName]||0) + (p.fulfillment[oldName]||0);
        delete p.fulfillment[oldName];
      }
    });
    saveDB(db);
    renderFulfillmentLocations();
  }
  
  function deleteFfLocation(name) {
    if (!confirm('Видалити фулфілмент-точку "'+name+'"? Залишки повернуться на головний склад.')) return;
    var db = getDB();
    db.fulfillmentLocations = (db.fulfillmentLocations||[]).filter(function(l){return l!==name});
    // Return stock to main
    db.products.forEach(function(p) {
      if (p.fulfillment && p.fulfillment[name]) {
        p.stock = (p.stock||0) + p.fulfillment[name];
        delete p.fulfillment[name];
      }
    });
    saveDB(db);
    renderFulfillmentLocations();
    renderPage('products');
  }

  window.openTransferFulfillment = openTransferFulfillment;
  window.transferToFulfillment = transferToFulfillment;
  window.returnFromFulfillment = returnFromFulfillment;
  window.toggleFfManager = toggleFfManager;
  window.applyFfManagerState = applyFfManagerState;
  window.renderFulfillmentLocations = renderFulfillmentLocations;
  window.addFfLocation = addFfLocation;
  window.renameFfLocation = renameFfLocation;
  window.deleteFfLocation = deleteFfLocation;
})();
