// ============================================================
// LipoLand — Worker Stock module
// ============================================================
// Склад майстрів: передача, прихід-самостійно, корекція, повернення.
// renderWorkerStock — таблиця, картки + worker-view (own materials).

(function(){
  'use strict';

  // ==================== WORKER STOCK ====================
  function populateTransferModal() {
    var db = getDB();
    var sel = document.getElementById('tw-worker');
    sel.innerHTML = getAllWorkerNames().map(function(w){ return '<option value="'+esc(w)+'">'+esc(wLabel(w))+'</option>'; }).join('');
    document.getElementById('tw-note').value = '';
    document.getElementById('tw-qty').value = 1;
    populateTransferItems();
  }
  
  function populateTransferItems() {
    // Reset selection when type changes
    document.getElementById('tw-search').value = '';
    document.getElementById('tw-item').value = '';
    filterTwItems();
  }
  
  function filterTwItems() {
    var db = getDB();
    var type = document.getElementById('tw-type').value;
    var q = (document.getElementById('tw-search').value || '').toLowerCase();
    var items;
    if (type === 'material') {
      items = db.materials.map(function(m){
        return { id:m.id, label: m.name + ' ('+fmt(m.qty)+' '+(m.unit||'')+')', search: (m.name||'').toLowerCase() };
      });
    } else {
      items = db.products.filter(function(p){return p.active!==false}).map(function(p){
        var label = (p.sku ? p.sku + ' — ' : '') + p.name;
        return { id:p.id, label: label, search: label.toLowerCase() };
      });
    }
    if (q) items = items.filter(function(it){ return it.search.indexOf(q) !== -1; });
    var dd = document.getElementById('tw-dropdown');
    dd.innerHTML = items.map(function(it){
      return '<div onclick="selectTwItem(\''+it.id+'\',\''+esc(it.label).replace(/'/g,"\\'")+'\')" style="padding:10px 12px;cursor:pointer;font-size:14px;border-bottom:1px solid var(--border);" onmouseover="this.style.background=\'var(--bg)\'" onmouseout="this.style.background=\'#fff\'">'+esc(it.label)+'</div>';
    }).join('') || '<div style="padding:12px;color:var(--text-light);font-size:13px;text-align:center;">Нічого не знайдено</div>';
    dd.style.display = 'block';
  }
  
  function selectTwItem(id, label) {
    document.getElementById('tw-item').value = id;
    document.getElementById('tw-search').value = label;
    document.getElementById('tw-dropdown').style.display = 'none';
  }
  
  // Close tw-dropdown when clicking outside
  document.addEventListener('click', function(e) {
    var dd = document.getElementById('tw-dropdown');
    if (dd && !e.target.closest('#tw-search') && !e.target.closest('#tw-dropdown')) {
      dd.style.display = 'none';
    }
  });
  
  function transferToWorker() {
    var db = getDB();
    if (!db.workerStock) db.workerStock = [];
    if (!db.workerStockHistory) db.workerStockHistory = [];
    var worker = document.getElementById('tw-worker').value;
    var type = document.getElementById('tw-type').value;
    var itemId = document.getElementById('tw-item').value;
    var qty = parseFloat(document.getElementById('tw-qty').value) || 0;
    var note = document.getElementById('tw-note').value;
    if (!worker || !itemId || qty <= 0) return alert('Заповніть всі поля');
  
    var itemName = '';
    if (type === 'material') {
      var mat = db.materials.find(function(m){return m.id===itemId});
      if (!mat) return;
      if (mat.qty < qty) { if(!confirm('На складі лише '+fmt(mat.qty)+' '+mat.unit+'. Все одно передати?')) return; }
      mat.qty = Math.max(0, mat.qty - qty);
      itemName = mat.name;
    } else {
      var prod = db.products.find(function(p){return p.id===itemId});
      if (!prod) return;
      if ((prod.stock||0) < qty) { if(!confirm('На складі лише '+(prod.stock||0)+' шт. Все одно передати?')) return; }
      prod.stock = Math.max(0, (prod.stock||0) - qty);
      itemName = prod.sku + ' — ' + prod.name;
    }
  
    // Check if same item already at worker — merge
    var existing = db.workerStock.find(function(s){ return s.worker===worker && s.itemId===itemId && s.type===type; });
    if (existing) {
      existing.qty += qty;
      existing.note = note || existing.note;
    } else {
      db.workerStock.push({ id:uid(), worker:worker, type:type, itemId:itemId, itemName:itemName, qty:qty, date:new Date().toISOString().slice(0,10), note:note });
    }
  
    db.workerStockHistory.push({ id:uid(), worker:worker, type:type, itemId:itemId, itemName:itemName, qty:qty, action:'передано', date:new Date().toISOString().slice(0,10), note:note });
  
    saveDB(db);
    closeModal('transfer-to-worker');
    renderPage('worker-stock');
  }
  
  // Worker adds own stock
  function openWorkerAddStockModal() {
    document.getElementById('was-qty').value = 1;
    document.getElementById('was-note').value = '';
    document.getElementById('was-type').value = 'material';
    populateWorkerAddItems();
    openModal('worker-add-stock');
  }
  
  function populateWorkerAddItems() {
    var db = getDB();
    var type = document.getElementById('was-type').value;
    var sel = document.getElementById('was-item');
    if (type === 'material') {
      sel.innerHTML = db.materials.map(function(m){ return '<option value="'+m.id+'">'+esc(m.name)+' ('+esc(m.unit)+')</option>'; }).join('');
    } else {
      sel.innerHTML = db.products.filter(function(p){return p.active!==false}).map(function(p){ return '<option value="'+p.id+'">'+(p.sku?esc(p.sku)+' — ':'')+esc(p.name)+'</option>'; }).join('');
    }
  }
  
  function workerAddStock() {
    if (!_currentUser || !_currentUser.isWorker) return;
    var wName = _currentUser.linkedWorkerName || _currentUser.name || '';
    if (!wName) return alert('Не вдалося визначити ваше ім\'я');
  
    var db = getDB();
    if (!db.workerStock) db.workerStock = [];
    if (!db.workerStockHistory) db.workerStockHistory = [];
  
    var type = document.getElementById('was-type').value;
    var itemId = document.getElementById('was-item').value;
    var qty = parseFloat(document.getElementById('was-qty').value) || 0;
    var note = document.getElementById('was-note').value.trim();
    if (!itemId || qty <= 0) return alert('Вкажіть позицію та кількість');
  
    var itemName = '';
    if (type === 'material') {
      var mat = db.materials.find(function(m){return m.id===itemId});
      if (mat) itemName = mat.name;
    } else {
      var prod = db.products.find(function(p){return p.id===itemId});
      if (prod) itemName = (prod.sku ? prod.sku + ' — ' : '') + prod.name;
    }
    if (!itemName) return;
  
    // Merge if already exists
    var existing = db.workerStock.find(function(s){ return s.worker===wName && s.itemId===itemId && s.type===type; });
    if (existing) {
      existing.qty += qty;
      existing.note = note || existing.note;
    } else {
      db.workerStock.push({ id:uid(), worker:wName, type:type, itemId:itemId, itemName:itemName, qty:qty, date:new Date().toISOString().slice(0,10), note:note||'додано майстром' });
    }
  
    db.workerStockHistory.push({ id:uid(), worker:wName, type:type, itemId:itemId, itemName:itemName, qty:qty, action:'додано', date:new Date().toISOString().slice(0,10), note:note||'додано майстром' });
  
    saveDB(db);
    closeModal('worker-add-stock');
    renderPage('worker-stock');
  }
  
  function workerEditQty(stockId) {
    var db = getDB();
    var item = (db.workerStock||[]).find(function(s){return s.id===stockId});
    if (!item) return;
    var oldQty = item.qty;
    var newQty = prompt('Скільки зараз "'+item.itemName+'"?', item.qty);
    if (newQty === null) return;
    newQty = parseFloat(newQty);
    if (isNaN(newQty) || newQty < 0) return alert('Вкажіть коректну кількість');
    var diff = newQty - item.qty;
    item.qty = newQty;
    if (!db.workerStockHistory) db.workerStockHistory = [];
    db.workerStockHistory.push({ id:uid(), worker:item.worker, type:item.type, itemId:item.itemId, itemName:item.itemName, qty:Math.abs(diff), action:diff>=0?'додано':'списано', date:new Date().toISOString().slice(0,10), note:'коригування майстром (було '+(item.qty-diff)+' → стало '+newQty+')' });
    logAudit(db, 'workerStock', stockId, 'adjust', { worker: item.worker, item: item.itemName, type: item.type, oldQty: oldQty, newQty: newQty, diff: diff });
    // Remove if zero
    if (newQty <= 0) db.workerStock = db.workerStock.filter(function(s){return s.id!==stockId});
    saveDB(db);
    renderPage('worker-stock');
  }
  
  function reassignWorkerStock(stockId) {
    var db = getDB();
    var item = (db.workerStock||[]).find(function(s){return s.id===stockId});
    if (!item) return;
    var workers = (typeof getAllWorkerNames==='function' ? getAllWorkerNames() : []).filter(function(w){return w && w!==item.worker});
    if (!workers.length) return alert('Немає інших майстрів для передачі');
    var listText = workers.map(function(w,i){return (i+1)+'. '+wLabel(w)}).join('\n');
    var pick = prompt('Передати «'+item.itemName+'» ('+fmt(item.qty)+') майстру:\n\n'+listText+'\n\nВведіть номер:');
    if (pick === null) return;
    var idx = parseInt(pick, 10) - 1;
    if (isNaN(idx) || idx < 0 || idx >= workers.length) return alert('Невірний номер');
    var newWorker = workers[idx];
    var oldWorker = item.worker;
    var movedQty = item.qty;
    var today = new Date().toISOString().slice(0,10);
    var existing = db.workerStock.find(function(s){return s.worker===newWorker && s.itemId===item.itemId && s.type===item.type});
    if (existing) {
      existing.qty += movedQty;
      existing.date = today;
      db.workerStock = db.workerStock.filter(function(s){return s.id!==item.id});
    } else {
      item.worker = newWorker;
      item.date = today;
    }
    if (!db.workerStockHistory) db.workerStockHistory = [];
    db.workerStockHistory.push({ id:uid(), worker:oldWorker, type:item.type, itemId:item.itemId, itemName:item.itemName, qty:movedQty, action:'передано: '+wLabel(oldWorker)+' → '+wLabel(newWorker), date:today, note:'' });
    saveDB(db);
    renderPage('worker-stock');
  }
  
  function returnFromWorker(stockId) {
    var db = getDB();
    if (!db.workerStock) return;
    var item = db.workerStock.find(function(s){return s.id===stockId});
    if (!item) return;
    var qtyStr = prompt('Скільки повернути? (є '+fmt(item.qty)+')', item.qty);
    if (qtyStr === null) return;
    var qty = parseFloat(qtyStr) || 0;
    if (qty <= 0 || qty > item.qty) return alert('Невірна кількість');
  
    // Return to main stock (materials → mat.qty, products → p.stock)
    if (item.type === 'material') {
      var mat = db.materials.find(function(m){return m.id===item.itemId});
      if (mat) mat.qty += qty;
    } else if (item.type === 'product') {
      var prod = db.products.find(function(p){return p.id===item.itemId});
      if (prod) prod.stock = (prod.stock||0) + qty;
    }
  
    item.qty -= qty;
    if (item.qty <= 0) {
      db.workerStock = db.workerStock.filter(function(s){return s.id!==stockId});
    }
  
    if (!db.workerStockHistory) db.workerStockHistory = [];
    db.workerStockHistory.push({ id:uid(), worker:item.worker, type:item.type, itemId:item.itemId, itemName:item.itemName, qty:qty, action:'повернуто', date:new Date().toISOString().slice(0,10), note:'' });
  
    saveDB(db);
    renderPage('worker-stock');
  }
  function renderWorkerStock() {
    var db = getDB();
    var isW = _currentUser && _currentUser.isWorker;
    var wName = isW ? (_currentUser.linkedWorkerName || '') : '';
    var wsPage = document.getElementById('worker-stock');
  
    // Update titles
    wsPage.querySelector('h2').textContent = isW ? 'Мої матеріали' : 'Склад майстрів';
    wsPage.querySelector('p').innerHTML = isW
      ? 'Матеріали, передані вам для роботи. Напівфабрикати керівник передає через <strong>Виробництво</strong>.'
      : 'Матеріали у майстрів. Напівфабрикати передаються через <strong>Виробництво</strong>.';
  
    // Toggle buttons for worker/owner
    var transferBtn = wsPage.querySelector('button[onclick*="transfer-to-worker"]');
    if (transferBtn) transferBtn.style.display = isW ? 'none' : '';
    var workerAddBtn = document.getElementById('ws-worker-add-btn');
    if (workerAddBtn) workerAddBtn.style.display = isW ? '' : 'none';
    var wsFilter = document.getElementById('ws-worker-filter');
    if (wsFilter) wsFilter.parentNode.style.display = isW ? 'none' : '';
    // Update section titles
    var tableTitle = document.getElementById('ws-table-title');
    if (tableTitle) tableTitle.textContent = isW ? 'Що у мене є' : 'Що знаходиться у майстрів';
  
    // Show only materials on this page; napivfabrikats live in Production now
    var stock = (db.workerStock || []).filter(function(s){ return s.type === 'material'; });
    var history = db.workerStockHistory || [];
    var filterWorker = document.getElementById('ws-worker-filter').value;
  
    // For worker — auto-filter by their name
    if (isW && wName) filterWorker = wName;
  
    // Populate filter (owner only)
    if (!isW) {
      var sel = document.getElementById('ws-worker-filter');
      var curVal = sel.value;
      var workerSet = {};
      stock.forEach(function(s){ workerSet[s.worker]=true; });
      sel.innerHTML = '<option value="">Всі майстри</option>' + Object.keys(workerSet).map(function(w){ return '<option value="'+esc(w)+'" '+(w===curVal?'selected':'')+'>'+esc(wLabel(w))+'</option>'; }).join('');
    }
  
    var filtered = stock;
    if (filterWorker) filtered = filtered.filter(function(s){ return s.worker===filterWorker; });
  
    // Summary cards
    var byWorker = {};
    filtered.forEach(function(s){
      if (!byWorker[s.worker]) byWorker[s.worker] = { materials:0, items:[] };
      byWorker[s.worker].materials += s.qty;
      byWorker[s.worker].items.push(s);
    });
  
    var cardsHtml = '';
    if (isW) {
      var myItems = filtered;
      if (myItems.length) {
        cardsHtml += '<div class="card"><div class="card-label">У мене матеріалів</div><div class="card-value">'+myItems.length+' <span style="font-size:14px;">позицій</span></div></div>';
      }
    } else {
      Object.keys(byWorker).forEach(function(w){
        var d = byWorker[w];
        cardsHtml += '<div class="card"><div class="card-label">'+esc(wLabel(w))+'</div><div class="card-value">'+d.items.length+' <span style="font-size:14px;">позицій</span></div><div class="card-sub">Всього матеріалів: '+fmt(d.materials)+'</div></div>';
      });
    }
    document.getElementById('ws-cards').innerHTML = cardsHtml || '<div class="text-muted">'+(isW?'Вам ще не передано матеріалів':'Матеріали ще не передавались майстрам')+'</div>';
  
    // Table — materials only
    if (isW) {
      document.getElementById('ws-table').innerHTML = filtered.map(function(s){
        return '<tr>'+
          '<td data-label="Матеріал"><strong>'+esc(s.itemName)+'</strong></td>'+
          '<td data-label="К-сть">'+fmt(s.qty)+'</td>'+
          '<td data-label="Дата">'+s.date+'</td>'+
          '<td data-label=""><button class="btn btn-outline btn-sm" onclick="workerEditQty(\''+s.id+'\')" title="Змінити кількість">✏️</button></td>'+
        '</tr>';
      }).join('') || '<tr><td colspan="4" class="text-muted" style="text-align:center;padding:40px;">Вам ще не передано матеріалів</td></tr>';
      var thead = document.querySelector('#worker-stock #ws-table').closest('table').querySelector('thead tr');
      if (thead) thead.innerHTML = '<th>Матеріал</th><th>Кількість</th><th>Дата</th><th></th>';
    } else {
      document.getElementById('ws-table').innerHTML = filtered.map(function(s){
        return '<tr>'+
          '<td data-label="Майстер"><strong>'+esc(wLabel(s.worker))+'</strong></td>'+
          '<td data-label="Матеріал">'+esc(s.itemName)+'</td>'+
          '<td data-label="К-сть">'+fmt(s.qty)+'</td>'+
          '<td data-label="Дата">'+s.date+'</td>'+
          '<td data-label="Коментар"><span class="note-text" title="'+(s.note?esc(s.note):'')+'">'+esc(s.note||'—')+'</span></td>'+
          '<td data-label="Дії" style="white-space:nowrap;">'+
            '<button class="btn btn-outline btn-sm" onclick="reassignWorkerStock(\''+s.id+'\')" title="Передати іншому майстру" style="margin-right:4px;">🔄 Іншому</button>'+
            '<button class="btn btn-outline btn-sm" onclick="returnFromWorker(\''+s.id+'\')" title="Повернути на склад">↩ Повернути</button>'+
          '</td>'+
        '</tr>';
      }).join('') || '<tr><td colspan="6" class="text-muted" style="text-align:center;padding:40px;">Матеріали ще не передавались</td></tr>';
      var thead = document.querySelector('#worker-stock #ws-table').closest('table').querySelector('thead tr');
      if (thead) thead.innerHTML = '<th>Майстер</th><th>Матеріал</th><th>Кількість</th><th>Дата передачі</th><th>Коментар</th><th>Дії</th>';
    }
  
    // History — materials only
    var filteredHistory = history.slice().filter(function(h){ return h.type === 'material'; }).reverse();
    if (filterWorker) filteredHistory = filteredHistory.filter(function(h){ return h.worker===filterWorker; });
    if (isW) {
      document.getElementById('ws-history').innerHTML = filteredHistory.slice(0,50).map(function(h){
        var actionBadge = h.action==='передано' ? '<span class="badge badge-warning">→ отримано</span>' : (h.action||'').indexOf('передано:')===0 ? '<span class="badge badge-warning" title="'+esc(h.action)+'">🔄 переведено</span>' : h.action==='додано' ? '<span class="badge badge-ok">+ додано</span>' : '<span class="badge badge-success">← повернуто</span>';
        return '<tr>'+
          '<td data-label="Дата">'+h.date+'</td>'+
          '<td data-label="Матеріал">'+esc(h.itemName)+'</td>'+
          '<td data-label="К-сть">'+fmt(h.qty)+'</td>'+
          '<td data-label="Дія">'+actionBadge+'</td>'+
        '</tr>';
      }).join('') || '<tr><td colspan="4" class="text-muted" style="text-align:center;padding:40px;">Історія порожня</td></tr>';
      var histThead = document.querySelector('#worker-stock #ws-history').closest('table').querySelector('thead tr');
      if (histThead) histThead.innerHTML = '<th>Дата</th><th>Матеріал</th><th>К-сть</th><th>Дія</th>';
    } else {
      document.getElementById('ws-history').innerHTML = filteredHistory.slice(0,50).map(function(h){
        var actionBadge = h.action==='передано' ? '<span class="badge badge-warning">→ передано</span>' : (h.action||'').indexOf('передано:')===0 ? '<span class="badge badge-warning" title="'+esc(h.action)+'">🔄 переведено між майстрами</span>' : h.action==='додано' ? '<span class="badge badge-ok">+ додано (майстер)</span>' : '<span class="badge badge-success">← повернуто</span>';
        return '<tr>'+
          '<td data-label="Дата">'+h.date+'</td>'+
          '<td data-label="Майстер">'+esc(wLabel(h.worker))+'</td>'+
          '<td data-label="Матеріал">'+esc(h.itemName)+'</td>'+
          '<td data-label="К-сть">'+fmt(h.qty)+'</td>'+
          '<td data-label="Дія">'+actionBadge+'</td>'+
          '<td data-label="Коментар">'+esc(h.note||'—')+'</td>'+
        '</tr>';
      }).join('') || '<tr><td colspan="6" class="text-muted" style="text-align:center;padding:40px;">Історія порожня</td></tr>';
      var histThead = document.querySelector('#worker-stock #ws-history').closest('table').querySelector('thead tr');
      if (histThead) histThead.innerHTML = '<th>Дата</th><th>Майстер</th><th>Матеріал</th><th>К-сть</th><th>Дія</th><th>Коментар</th>';
    }
  
    // Owner's materials stock (worker view only)
    var ownerStockEl = document.getElementById('ws-owner-stock');
    if (isW && ownerStockEl) {
      ownerStockEl.style.display = 'block';
      var ownerName = (_currentUser && _currentUser.ownerName) || 'керівника';
      document.getElementById('ws-owner-stock-title').textContent = 'На складі у ' + ownerName;
      var wp = (_currentUser && _currentUser.workerPermissions) || {};
      var mats = db.materials.filter(function(m){ return m.qty > 0 || m.min > 0; });
      document.getElementById('ws-owner-materials').innerHTML = mats.map(function(m){
        var total = matTotalQty(db, m);
        var status = total <= 0 ? '<span class="badge badge-danger">Немає</span>'
          : total <= m.min ? '<span class="badge badge-warning">Мало</span>'
          : '<span class="badge badge-ok">Є</span>';
        return '<tr>'+
          '<td data-label="Матеріал">'+esc(m.name)+'</td>'+
          '<td data-label="Залишок">'+fmt(m.qty)+' '+esc(m.unit)+'</td>'+
          '<td data-label="Статус">'+status+'</td>'+
        '</tr>';
      }).join('') || '<tr><td colspan="3" class="text-muted" style="text-align:center;padding:20px;">Склад порожній</td></tr>';
    } else if (ownerStockEl) {
      ownerStockEl.style.display = 'none';
    }
  }

  window.populateTransferModal = populateTransferModal;
  window.populateTransferItems = populateTransferItems;
  window.filterTwItems = filterTwItems;
  window.selectTwItem = selectTwItem;
  window.transferToWorker = transferToWorker;
  window.openWorkerAddStockModal = openWorkerAddStockModal;
  window.populateWorkerAddItems = populateWorkerAddItems;
  window.workerAddStock = workerAddStock;
  window.workerEditQty = workerEditQty;
  window.reassignWorkerStock = reassignWorkerStock;
  window.returnFromWorker = returnFromWorker;
  window.renderWorkerStock = renderWorkerStock;
})();
