// ============================================================
// LipoLand — Invoice OCR module
// ============================================================
// Фото накладної → OpenAI Vision OCR → автоматичне додавання матеріалів
// з прив'язкою до існуючих позицій. Undo-логіка зберігає попередні стани.
// window._invoiceItems / window._invoiceNumber / window._lastInvoiceUndo — стейт на window.

(function(){
  'use strict';

  // ==================== INVOICE OCR ====================
  window._invoiceItems = [];
  window._invoiceNumber = "";
  
  function uploadInvoice(input) {
    if (!input.files || !input.files[0]) return;
    var file = input.files[0];
    if (file.size > 10 * 1024 * 1024) { alert('Файл завеликий (макс 10 МБ)'); input.value=''; return; }
    openModal('invoice');
    document.getElementById('invoice-status').innerHTML = '<div style="text-align:center;padding:20px;"><div style="font-size:24px;margin-bottom:8px;">🔍</div><span class="text-muted">Розпізнаю накладну...</span></div>';
    document.getElementById('invoice-items').innerHTML = '';
    document.getElementById('invoice-actions').style.display = 'none';
    // Show preview
    var reader = new FileReader();
    reader.onload = function(e) {
      document.getElementById('invoice-preview').innerHTML = '<img src="'+e.target.result+'" style="max-width:100%;max-height:180px;border-radius:8px;border:1px solid var(--border);">';
      // Send to server
      var formData = new FormData();
      formData.append('image', file);
      fetch('/api/parse-invoice', { method:'POST', body: formData })
        .then(function(r){ return r.json(); })
        .then(function(data){
          if (data.error) {
            document.getElementById('invoice-status').innerHTML = '<div class="alert alert-warning">❌ '+esc(data.error)+'</div>';
            return;
          }
          window._invoiceItems = data.items || [];
          window._invoiceNumber = data.invoiceNumber || '';
          renderInvoiceItems();
        })
        .catch(function(err){
          document.getElementById('invoice-status').innerHTML = '<div class="alert alert-warning">❌ Помилка: '+esc(err.message)+'</div>';
        });
    };
    reader.readAsDataURL(file);
    input.value = '';
  }
  
  function renderInvoiceItems() {
    if (!window._invoiceItems.length) {
      document.getElementById('invoice-status').innerHTML = '<div class="alert alert-warning">Не вдалось знайти товари на фото. Спробуйте інше фото.</div>';
      return;
    }
    var db = getDB();
    document.getElementById('invoice-status').innerHTML = '<div style="color:var(--success);font-weight:600;margin-bottom:8px;">✅ Знайдено '+window._invoiceItems.length+' позицій. Перевірте та відредагуйте:</div>';
    var html = '<div style="display:flex;flex-direction:column;gap:8px;">';
    window._invoiceItems.forEach(function(item, i) {
      // Try to match to existing material
      var matchId = '';
      var matchLabel = '';
      db.materials.forEach(function(m) {
        if (m.name && item.name && m.name.toLowerCase().indexOf(item.name.toLowerCase().slice(0,10)) !== -1) { matchId = m.id; matchLabel = m.name; }
      });
      var actionOptions = '<option value="new"'+(matchId?'':' selected')+'>➕ Новий матеріал</option>' +
        '<option value="add"'+(matchId?' selected':'')+'>📦 Додати до існуючого</option>' +
        '<option value="skip">⏭ Пропустити</option>';
      var existingOpts = db.materials.map(function(m){ return '<option value="'+m.id+'"'+(m.id===matchId?' selected':'')+'>'+esc(m.name)+'</option>'; }).join('');
      html += '<div style="padding:10px;background:#fafafa;border:1px solid var(--border);border-radius:8px;" id="inv-item-'+i+'">' +
        '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:6px;">' +
          '<select onchange="toggleInvAction('+i+')" id="inv-action-'+i+'" style="padding:4px 8px;border-radius:6px;border:1px solid var(--border);font-size:12px;">'+actionOptions+'</select>' +
          '<span style="font-weight:600;font-size:13px;">'+esc(item.name)+'</span>' +
        '</div>' +
        '<div style="display:flex;gap:8px;flex-wrap:wrap;font-size:12px;align-items:end;">' +
          '<label style="display:flex;flex-direction:column;gap:2px;">Назва<input id="inv-name-'+i+'" value="'+esc(item.name)+'" style="padding:4px 6px;width:180px;font-size:12px;"></label>' +
          '<label style="display:flex;flex-direction:column;gap:2px;">К-сть<input id="inv-qty-'+i+'" type="number" value="'+(item.qty||1)+'" style="padding:4px 6px;width:55px;font-size:12px;" readonly></label>' +
          '<label style="display:flex;flex-direction:column;gap:2px;" title="Скільки одиниць в 1 упаковці (напр. 300 листів). Залиште 0 якщо не потрібно розпаковувати.">В упак.<input id="inv-pack-'+i+'" type="number" value="0" min="0" placeholder="0" style="padding:4px 6px;width:55px;font-size:12px;" oninput="recalcInvItem('+i+')"></label>' +
          '<label style="display:flex;flex-direction:column;gap:2px;">Од.<input id="inv-unit-'+i+'" value="'+(item.unit||'шт')+'" style="padding:4px 6px;width:45px;font-size:12px;" oninput="recalcInvItem('+i+')"></label>' +
          '<label style="display:flex;flex-direction:column;gap:2px;">Ціна/од.<input id="inv-price-'+i+'" type="number" step="0.01" value="'+(item.price||0)+'" style="padding:4px 6px;width:75px;font-size:12px;" readonly></label>' +
          '<label style="display:flex;flex-direction:column;gap:2px;">Сума<span style="padding:4px;font-weight:600;color:var(--primary);">'+(item.total||0)+' грн</span></label>' +
        '</div>' +
        '<div id="inv-calc-'+i+'" style="margin-top:4px;font-size:11px;color:var(--primary-dark);font-weight:600;"></div>' +
        '<div id="inv-existing-'+i+'" style="margin-top:6px;'+(matchId?'':'display:none;')+'"><label style="font-size:12px;">Додати до: <select id="inv-match-'+i+'" style="padding:4px 6px;font-size:12px;">'+existingOpts+'</select></label></div>' +
      '</div>';
    });
    html += '</div>';
    document.getElementById('invoice-items').innerHTML = html;
    document.getElementById('invoice-actions').style.display = 'flex';
  }
  
  function toggleInvAction(i) {
    var action = document.getElementById('inv-action-'+i).value;
    document.getElementById('inv-existing-'+i).style.display = action === 'add' ? 'block' : 'none';
  }
  
  function recalcInvItem(i) {
    var item = window._invoiceItems[i];
    if (!item) return;
    var pack = parseInt(document.getElementById('inv-pack-'+i).value) || 0;
    var unit = document.getElementById('inv-unit-'+i).value || 'шт';
    var el = document.getElementById('inv-calc-'+i);
    if (pack > 0) {
      var origQty = item.qty || 1;
      var totalQty = origQty * pack;
      var pricePerUnit = Math.round((item.total || 0) / totalQty * 100) / 100;
      document.getElementById('inv-qty-'+i).value = totalQty;
      document.getElementById('inv-price-'+i).value = pricePerUnit;
      el.innerHTML = '→ ' + origQty + ' уп. × ' + pack + ' = <b>' + totalQty + '</b> ' + esc(unit) + ', ціна: <b>' + fmt(pricePerUnit) + ' грн/' + esc(unit) + '</b>';
    } else {
      document.getElementById('inv-qty-'+i).value = item.qty || 1;
      document.getElementById('inv-price-'+i).value = item.price || 0;
      el.innerHTML = '';
    }
  }
  
  window._lastInvoiceUndo = null;
  
  function applyInvoiceItems() {
    var db = getDB();
    var added = 0, updated = 0, skipped = 0;
    var undoActions = []; // Track what we did for undo
    window._invoiceItems.forEach(function(item, i) {
      var action = document.getElementById('inv-action-'+i).value;
      if (action === 'skip') { skipped++; return; }
      var name = document.getElementById('inv-name-'+i).value.trim();
      var qty = parseFloat(document.getElementById('inv-qty-'+i).value) || 0;
      var unit = document.getElementById('inv-unit-'+i).value.trim() || 'шт';
      var price = parseFloat(document.getElementById('inv-price-'+i).value) || 0;
      if (!name || qty <= 0) { skipped++; return; }
      if (action === 'add') {
        var matchId = document.getElementById('inv-match-'+i).value;
        var existing = db.materials.find(function(m){ return m.id===matchId; });
        if (existing) {
          undoActions.push({ type:'updated', id:existing.id, prevQty:existing.qty, prevPrice:existing.price, addedQty:qty });
          existing.qty = (existing.qty||0) + qty;
          if (price > 0) existing.price = price;
          updated++;
        } else { skipped++; }
      } else {
        var newId = uid();
        db.materials.push({ id: newId, name: name, unit: unit, qty: qty, min: 0, price: price, supplier: '', note: 'Додано з накладної' });
        undoActions.push({ type:'added', id:newId });
        added++;
      }
    });
    // Save invoice to history
    var totalSum = 0;
    var itemCount = added + updated;
    window._invoiceItems.forEach(function(item, i) {
      var action = document.getElementById('inv-action-'+i).value;
      if (action !== 'skip') totalSum += (item.total || 0);
    });
    if (!db.invoiceHistory) db.invoiceHistory = [];
    var invRecord = {
      id: uid(),
      date: new Date().toISOString().slice(0,10),
      number: '',
      items: itemCount,
      total: totalSum,
      undoActions: undoActions
    };
    if (window._invoiceNumber) invRecord.number = window._invoiceNumber;
    db.invoiceHistory.push(invRecord);
  
    // Auto-create expense for invoice total
    if (totalSum > 0) {
      if (!db.expenses) db.expenses = [];
      db.expenses.push({
        id: uid(),
        date: new Date().toISOString().slice(0,10),
        category: '📦 Закупка матеріалів',
        amount: Math.round(totalSum * 100) / 100,
        note: 'Накладна' + (window._invoiceNumber ? ' №' + window._invoiceNumber : '') + ': ' + itemCount + ' поз., ' + fmt(totalSum) + ' грн',
        auto: true,
        invoiceId: invRecord.id
      });
    }
  
    saveDB(db);
    window._lastInvoiceUndo = { actions: undoActions, invoiceId: invRecord.id, date: new Date().toISOString() };
    closeModal('invoice');
    renderPage('materials');
    alert('Готово! Додано нових: '+added+', оновлено: '+updated+(skipped>0 ? ', пропущено: '+skipped : '')+'\n\nЯкщо помилка — натисніть "Скасувати накладну" на сторінці матеріалів.');
  }
  
  function undoLastInvoice() {
    if (!window._lastInvoiceUndo || !window._lastInvoiceUndo.actions.length) { alert('Нема чого скасовувати'); return; }
    if (!confirm('Скасувати останнє завантаження накладної? Видалить додані матеріали та поверне кількості.')) return;
    var db = getDB();
    window._lastInvoiceUndo.actions.forEach(function(a) {
      if (a.type === 'added') {
        db.materials = db.materials.filter(function(m){ return m.id !== a.id; });
      } else if (a.type === 'updated') {
        var m = db.materials.find(function(m){ return m.id === a.id; });
        if (m) { m.qty = a.prevQty; m.price = a.prevPrice; }
      }
    });
    // Remove from invoice history
    if (window._lastInvoiceUndo.invoiceId) {
      db.invoiceHistory = (db.invoiceHistory||[]).filter(function(h){ return h.id !== window._lastInvoiceUndo.invoiceId; });
    }
    saveDB(db);
    window._lastInvoiceUndo = null;
    renderPage('materials');
    alert('Скасовано! Матеріали повернуто як було.');
  }

  window.uploadInvoice = uploadInvoice;
  window.renderInvoiceItems = renderInvoiceItems;
  window.toggleInvAction = toggleInvAction;
  window.recalcInvItem = recalcInvItem;
  window.applyInvoiceItems = applyInvoiceItems;
  window.undoLastInvoice = undoLastInvoice;
})();
