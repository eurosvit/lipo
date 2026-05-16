// ============================================================
// LipoLand — Materials module
// ============================================================
// Сировина для виробництва: ліпучки, плівка, папір тощо.
// CRUD + прихід по накладних + історія накладних + bulk-операції.
// OCR накладних (uploadInvoice, undoLastInvoice) — поки в index.html.

(function(){
  'use strict';

  // ==================== MATERIALS ====================
  function saveMaterial() {
    const db = getDB();
    var waste = Math.max(0, Math.min(100, n('mat-waste')||0));
    const m = { id:uid(), name:v('mat-name'), category:v('mat-category'), unit:v('mat-unit'), qty:n('mat-qty'), min:n('mat-min'), price:n('mat-price'), wastePercent:waste, supplier:v('mat-supplier'), note:v('mat-note') };
    if(!m.name) return alert('Введіть назву');
    db.materials.push(m);
    saveDB(db);
    closeModal('add-material');
    document.getElementById('mat-name').value='';
    document.getElementById('mat-category').value='';
    document.getElementById('mat-note').value='';
    document.getElementById('mat-waste').value='0';
    renderPage('materials');
  }
  
  function editMaterial(id) {
    const db = getDB();
    const m = db.materials.find(function(x){return x.id===id});
    if(!m) return;
    document.getElementById('emat-id').value = id;
    document.getElementById('emat-name').value = m.name;
    document.getElementById('emat-category').value = m.category||'';
    document.getElementById('emat-unit').value = m.unit;
    document.getElementById('emat-qty').value = m.qty;
    document.getElementById('emat-min').value = m.min;
    document.getElementById('emat-price').value = m.price;
    document.getElementById('emat-waste').value = m.wastePercent || 0;
    document.getElementById('emat-supplier').value = m.supplier||'';
    document.getElementById('emat-note').value = m.note||'';
    openModal('edit-material');
  }
  
  function updateMaterial() {
    const db = getDB();
    const id = document.getElementById('emat-id').value;
    const m = db.materials.find(function(x){return x.id===id});
    if(!m) return;
    m.name = v('emat-name'); m.category = v('emat-category'); m.unit = v('emat-unit'); m.qty = n('emat-qty');
    m.min = n('emat-min'); m.price = n('emat-price'); m.supplier = v('emat-supplier');
    m.wastePercent = Math.max(0, Math.min(100, n('emat-waste')||0));
    m.note = v('emat-note');
    saveDB(db);
    closeModal('edit-material');
    renderPage('materials');
  }
  
  function deleteMaterial(id) {
    if(!confirm('Видалити цей матеріал?')) return;
    const db = getDB();
    db.materials = db.materials.filter(function(x){return x.id!==id});
    saveDB(db);
    renderPage('materials');
  }
  
  function populateReceiveMat() {
    document.getElementById('recv-mat-search').value = '';
    document.getElementById('recv-mat').value = '';
    document.getElementById('recv-mat-dropdown').style.display = 'none';
  }
  function filterRecvMat() {
    var db = getDB();
    var q = (document.getElementById('recv-mat-search').value || '').toLowerCase().trim();
    var items = (db.materials||[]).map(function(m){
      return { id:m.id, label: m.name + ' ('+fmt(m.qty)+' '+(m.unit||'')+')', search: (m.name||'').toLowerCase() };
    });
    if (q) items = items.filter(function(it){ return it.search.indexOf(q) !== -1; });
    var dd = document.getElementById('recv-mat-dropdown');
    dd.innerHTML = items.map(function(it){
      return '<div onclick="selectRecvMat(\''+it.id+'\',\''+esc(it.label).replace(/\'/g,"\\\'")+'\')" style="padding:10px 12px;cursor:pointer;font-size:14px;border-bottom:1px solid var(--border);" onmouseover="this.style.background=\'var(--bg)\'" onmouseout="this.style.background=\'#fff\'">'+esc(it.label)+'</div>';
    }).join('') || '<div style="padding:12px;color:var(--text-light);font-size:13px;text-align:center;">Нічого не знайдено</div>';
    dd.style.display = 'block';
  }
  function selectRecvMat(id, label) {
    document.getElementById('recv-mat').value = id;
    document.getElementById('recv-mat-search').value = label;
    document.getElementById('recv-mat-dropdown').style.display = 'none';
  }
  document.addEventListener('click', function(e) {
    var dd = document.getElementById('recv-mat-dropdown');
    if (dd && !e.target.closest('#recv-mat-search') && !e.target.closest('#recv-mat-dropdown')) {
      dd.style.display = 'none';
    }
  });
  
  function receiveMaterial() {
    var db = getDB();
    var id = v('recv-mat');
    var qty = n('recv-qty');
    var price = document.getElementById('recv-price').value ? n('recv-price') : null;
    var deliveryEl = document.getElementById('recv-delivery');
    var delivery = (deliveryEl && deliveryEl.value) ? parseFloat(deliveryEl.value) || 0 : 0;
    var m = db.materials.find(function(x){return x.id===id});
    if(!m || qty<=0) return alert('Оберіть матеріал та введіть кількість');
    m.qty += qty;
    var unitPrice = price !== null ? price : m.price;
    if(price!==null) m.price = price;
    // Auto-create expense for material purchase
    var totalCost = qty * unitPrice;
    var today = new Date().toISOString().slice(0,10);
    if (!db.expenses) db.expenses = [];
    if (totalCost > 0) {
      db.expenses.push({
        id: uid(),
        date: today,
        category: '📦 Закупка матеріалів',
        amount: Math.round(totalCost * 100) / 100,
        note: 'Прихід: ' + m.name + ' × ' + qty + ' ' + (m.unit||'шт') + ' по ' + fmt(unitPrice) + ' грн',
        auto: true
      });
    }
    // Auto-create expense for delivery
    if (delivery > 0) {
      db.expenses.push({
        id: uid(),
        date: today,
        category: '📦 Доставка',
        amount: Math.round(delivery * 100) / 100,
        note: '🚚 Доставка матеріалу: ' + m.name + ' (' + qty + ' ' + (m.unit||'шт') + ')',
        auto: true
      });
    }
    saveDB(db);
    if (deliveryEl) deliveryEl.value = '';
    closeModal('receive-material');
    renderPage('materials');
  }
  
  var _matCategoryLabels = {
    'paper': '📄 Папір / Плівка',
    'velcro': '🧲 Ліпучки',
    'components': '🔩 Комплектуючі',
    'packaging': '📦 Пакування',
    'equipment': '🔧 Для обладнання',
    'other': '📁 Інше',
    '': '📋 Без категорії'
  };
  var _matCategoryColors = {
    'paper': '#E3F2FD;border-left:4px solid #1976D2',
    'velcro': '#FCE4EC;border-left:4px solid #E91E63',
    'components': '#FFF3E0;border-left:4px solid #E65100',
    'packaging': '#E8F5E9;border-left:4px solid #2E7D32',
    'equipment': '#F3E5F5;border-left:4px solid #7B1FA2',
    'other': '#F5F5F5;border-left:4px solid #9E9E9E',
    '': '#FAFAFA;border-left:4px solid #BDBDBD'
  };
  var _matCategoryOrder = ['paper', 'velcro', 'components', 'packaging', 'equipment', 'other', ''];
  
  function renderMaterials() {
    var db = getDB();
    var undoBtn = document.getElementById('undo-invoice-btn');
    if (undoBtn) undoBtn.style.display = (_lastInvoiceUndo && _lastInvoiceUndo.actions.length) ? 'inline-block' : 'none';
    var tb = document.getElementById('materials-table');
  
    // Group materials by category
    var groups = {};
    db.materials.forEach(function(m) {
      var cat = m.category || '';
      if (!groups[cat]) groups[cat] = [];
      groups[cat].push(m);
    });
  
    // Build rows grouped by category
    var html = '';
    var hasAny = false;
    _matCategoryOrder.forEach(function(cat) {
      if (!groups[cat] || groups[cat].length === 0) return;
      hasAny = true;
      var label = _matCategoryLabels[cat] || cat;
      var color = _matCategoryColors[cat] || '#FAFAFA;border-left:4px solid #BDBDBD';
      html += '<tr><td colspan="11" style="background:'+color+';padding:10px 16px;font-weight:700;font-size:14px;letter-spacing:0.3px;">'+label+' <span style="font-weight:400;font-size:12px;color:var(--text-light);">('+groups[cat].length+')</span></td></tr>';
      groups[cat].forEach(function(m) {
        var atW = matAtWorkers(db, m.id);
        var total = (m.qty||0) + atW;
        var status = total <= 0 ? '<span class="badge badge-danger">Немає!</span>'
          : total <= m.min ? '<span class="badge badge-warning">Замовити!</span>'
          : '<span class="badge badge-ok">Ок</span>';
        var qtyCell = atW>0 ? fmt(m.qty)+' <small style="color:var(--text-light);">+'+fmt(atW)+' у майстр.</small>' : fmt(m.qty);
        var supplierHtml = m.supplier ? esc(m.supplier) : '—';
        var noteHtml = m.note ? '<span class="note-text" title="'+esc(m.note)+'">'+esc(m.note)+'</span>' : '—';
        html += '<tr>'+
          '<td><input type="checkbox" class="mat-cb" value="'+m.id+'" onchange="updateMatSelection()" style="width:18px;height:18px;accent-color:var(--primary);"></td>'+
          '<td data-label="Назва"><strong>'+esc(m.name)+'</strong></td>'+
          '<td data-label="Од.">'+esc(m.unit)+'</td>'+
          '<td data-label="Залишок">'+qtyCell+'</td>'+
          '<td data-label="Мінімум">'+fmt(m.min)+'</td>'+
          '<td data-label="Ціна/од.">'+fmt(m.price)+' грн</td>'+
          '<td data-label="Брак">'+((m.wastePercent||0)>0 ? '<span style="color:#E65100;font-weight:600;">'+fmt(m.wastePercent)+'%</span>' : '<span style="color:var(--text-light);">—</span>')+'</td>'+
          '<td data-label="Постачальник">'+supplierHtml+'</td>'+
          '<td data-label="Коментар">'+noteHtml+'</td>'+
          '<td data-label="Статус">'+status+'</td>'+
          '<td data-label="Дії" style="white-space:nowrap;"><button class="btn btn-outline btn-sm" onclick="editMaterial(\''+m.id+'\')">&#x270F;&#xFE0F;</button> <button class="btn btn-danger btn-sm" onclick="deleteMaterial(\''+m.id+'\')">&#x1F5D1;</button></td>'+
        '</tr>';
      });
    });
  
    tb.innerHTML = hasAny ? html : '<tr><td colspan="11" class="text-muted" style="text-align:center;padding:40px;">Додайте перший матеріал</td></tr>';
  
    // Stock value summary
    var summaryEl = document.getElementById('mat-stock-summary');
    if (summaryEl) {
      var totalValue = 0, totalItems = 0, lowStock = 0, outOfStock = 0;
      db.materials.forEach(function(m) {
        var total = matTotalQty(db, m);
        totalValue += total * (m.price || 0);
        totalItems++;
        if (total <= 0) outOfStock++;
        else if (total <= m.min) lowStock++;
      });
      summaryEl.innerHTML =
        '<span style="font-weight:700;color:var(--primary-dark);">💰 На складі матеріалів: <span style="font-size:18px;">' + fmt(totalValue) + ' грн</span></span>' +
        '<span style="color:var(--text-light);">📋 ' + totalItems + ' позицій</span>' +
        (outOfStock > 0 ? '<span style="color:var(--danger);font-weight:600;">❌ Немає: ' + outOfStock + '</span>' : '') +
        (lowStock > 0 ? '<span style="color:#E65100;font-weight:600;">⚠️ Замовити: ' + lowStock + '</span>' : '');
    }
  
    renderInvoiceHistory();
    renderPackagingKits();
  }
  function renderInvoiceHistory() {
    var db = getDB();
    if (!db.invoiceHistory) db.invoiceHistory = [];
    var tb = document.getElementById('invoice-history-table');
    if (!tb) return;
    var sorted = db.invoiceHistory.slice().sort(function(a,b){ return b.date.localeCompare(a.date); });
    tb.innerHTML = sorted.map(function(h) {
      var canUndo = _lastInvoiceUndo && _lastInvoiceUndo.invoiceId === h.id;
      return '<tr>'+
        '<td data-label="Дата">'+esc(h.date)+'</td>'+
        '<td data-label="№ накладної">'+(h.number ? esc(h.number) : '—')+'</td>'+
        '<td data-label="Позицій">'+h.items+'</td>'+
        '<td data-label="Сума">'+fmt(h.total)+' грн</td>'+
        '<td data-label="Дії">'+
          (canUndo ? '<button class="btn btn-danger btn-sm" onclick="undoLastInvoice()" title="Скасувати">↩</button> ' : '')+
          '<button class="btn btn-outline btn-sm" onclick="deleteInvoiceHistory(\''+h.id+'\')" title="Видалити запис">🗑</button>'+
        '</td>'+
      '</tr>';
    }).join('') || '<tr><td colspan="5" class="text-muted" style="text-align:center;padding:24px;">Ще немає накладних</td></tr>';
  }
  
  function deleteInvoiceHistory(id) {
    if (!confirm('Видалити запис з історії? (Матеріали не зміняться)')) return;
    var db = getDB();
    db.invoiceHistory = (db.invoiceHistory||[]).filter(function(h){ return h.id !== id; });
    if (_lastInvoiceUndo && _lastInvoiceUndo.invoiceId === id) _lastInvoiceUndo = null;
    saveDB(db);
    renderPage('materials');
  }
  
  function toggleAllMaterials(checked) {
    document.querySelectorAll('.mat-cb').forEach(function(cb){ cb.checked = checked; });
    updateMatSelection();
  }
  
  function updateMatSelection() {
    var checked = document.querySelectorAll('.mat-cb:checked');
    var bar = document.getElementById('mat-bulk-bar');
    if (checked.length > 0) {
      bar.style.display = 'flex';
      document.getElementById('mat-selected-count').textContent = 'Обрано: ' + checked.length;
    } else {
      bar.style.display = 'none';
    }
    var all = document.querySelectorAll('.mat-cb');
    document.getElementById('mat-select-all').checked = all.length > 0 && checked.length === all.length;
  }
  
  function clearMatSelection() {
    document.querySelectorAll('.mat-cb').forEach(function(cb){ cb.checked = false; });
    document.getElementById('mat-select-all').checked = false;
    document.getElementById('mat-bulk-bar').style.display = 'none';
  }
  
  function bulkDeleteMaterials() {
    var ids = [];
    document.querySelectorAll('.mat-cb:checked').forEach(function(cb){ ids.push(cb.value); });
    if (!ids.length) return;
    if (!confirm('Видалити ' + ids.length + ' матеріалів? Це незворотна дія.')) return;
    var db = getDB();
    db.materials = db.materials.filter(function(m){ return ids.indexOf(m.id) === -1; });
    saveDB(db);
    renderMaterials();
  }

  window.saveMaterial = saveMaterial;
  window.editMaterial = editMaterial;
  window.updateMaterial = updateMaterial;
  window.deleteMaterial = deleteMaterial;
  window.populateReceiveMat = populateReceiveMat;
  window.filterRecvMat = filterRecvMat;
  window.selectRecvMat = selectRecvMat;
  window.receiveMaterial = receiveMaterial;
  window.renderMaterials = renderMaterials;
  window.renderInvoiceHistory = renderInvoiceHistory;
  window.deleteInvoiceHistory = deleteInvoiceHistory;
  window.toggleAllMaterials = toggleAllMaterials;
  window.updateMatSelection = updateMatSelection;
  window.clearMatSelection = clearMatSelection;
  window.bulkDeleteMaterials = bulkDeleteMaterials;
})();
