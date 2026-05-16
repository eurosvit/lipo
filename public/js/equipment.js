// ============================================================
// LipoLand — Equipment + Printer/Ink + Service Log module
// ============================================================
// Принтер: налаштування, грн/стор автоматично, заправки чорнил.
// Обладнання: CRUD + service log (журнал обслуговування).

(function(){
  'use strict';

  // ==================== PRINTER & INK ====================
  function savePrinterSettings() {
    var db = getDB();
    db.printerSettings = {
      colors: parseInt(v('printer-colors'))||6,
      refillPrice: parseFloat(v('printer-refill-price'))||0,
      refillVolumeMl: parseFloat(v('printer-refill-volume'))||0,
      mlPerPage: parseFloat(v('printer-ml-per-page'))||0,
      costPerPageA4: parseFloat(v('printer-cost-per-page'))||0,
      inkCostPerMl: parseFloat(v('printer-ink-cost-ml'))||0
    };
    saveDB(db);
    alert('✅ Налаштування принтера збережено!');
  }
  
  // Автоматичний розрахунок: грн/стор = мл/стор × грн/мл
  function recalcPrintCost() {
    var refillPrice = parseFloat(v('printer-refill-price'))||0;
    var refillVolume = parseFloat(v('printer-refill-volume'))||0;
    var mlPerPage = parseFloat(v('printer-ml-per-page'))||0;
    var mlResultEl = document.getElementById('printer-ml-result');
    var formulaEl = document.getElementById('printer-calc-formula');
    var mlDisplay = document.getElementById('printer-cost-ml-display');
    var pageDisplay = document.getElementById('printer-cost-page-display');
  
    // Крок 1: грн за мл
    var costPerMl = 0;
    if (refillPrice > 0 && refillVolume > 0) {
      costPerMl = refillPrice / refillVolume;
      if (mlResultEl) mlResultEl.innerHTML = '→ <strong>'+fmt(costPerMl)+' грн за 1 мл</strong> <span style="color:var(--text-light);">('+fmt(refillPrice)+' ÷ '+refillVolume+' мл)</span>';
    } else if (mlResultEl) {
      mlResultEl.innerHTML = '';
    }
  
    // Крок 3: грн за сторінку = мл/стор × грн/мл
    var costPerPage = 0;
    if (costPerMl > 0 && mlPerPage > 0) {
      costPerPage = mlPerPage * costPerMl;
      if (formulaEl) formulaEl.innerHTML = fmt(mlPerPage)+' мл/стор × '+fmt(costPerMl)+' грн/мл';
    } else if (formulaEl) {
      formulaEl.innerHTML = 'Заповни Крок 1 і Крок 2 вище — побачиш результат тут.';
    }
  
    if (mlDisplay) mlDisplay.textContent = costPerMl > 0 ? fmt(costPerMl) : '—';
    if (pageDisplay) pageDisplay.textContent = costPerPage > 0 ? fmt(costPerPage) : '—';
  
    // Записати в приховані поля (щоб зберегти через savePrinterSettings)
    var cppEl = document.getElementById('printer-cost-per-page');
    var icmlEl = document.getElementById('printer-ink-cost-ml');
    if (cppEl) cppEl.value = Math.round(costPerPage * 100) / 100;
    if (icmlEl) icmlEl.value = Math.round(costPerMl * 100) / 100;
  
    // Також оновити поля ручного режиму (якщо вони порожні)
    var manualPage = document.getElementById('printer-cost-per-page-manual');
    var manualMl = document.getElementById('printer-ink-cost-ml-manual');
    if (manualPage && !manualPage.dataset.edited) manualPage.value = costPerPage > 0 ? Math.round(costPerPage * 100) / 100 : '';
    if (manualMl && !manualMl.dataset.edited) manualMl.value = costPerMl > 0 ? Math.round(costPerMl * 100) / 100 : '';
  }
  
  // Перезапис результату вручну
  function overrideCostPerPage() {
    var manual = document.getElementById('printer-cost-per-page-manual');
    if (!manual) return;
    manual.dataset.edited = '1';
    var val = parseFloat(manual.value)||0;
    document.getElementById('printer-cost-per-page').value = val;
    document.getElementById('printer-cost-page-display').textContent = val > 0 ? fmt(val) : '—';
    document.getElementById('printer-calc-formula').innerHTML = '<em>Встановлено вручну</em>';
  }
  function overrideInkCostMl() {
    var manual = document.getElementById('printer-ink-cost-ml-manual');
    if (!manual) return;
    manual.dataset.edited = '1';
    var val = parseFloat(manual.value)||0;
    document.getElementById('printer-ink-cost-ml').value = val;
    document.getElementById('printer-cost-ml-display').textContent = val > 0 ? fmt(val) : '—';
  }
  
  function addInkRefill() {
    var db = getDB();
    if (!db.inkRefills) db.inkRefills = [];
    var refill = {
      id: uid(),
      date: v('ink-date') || new Date().toISOString().slice(0,10),
      color: v('ink-color'),
      cost: n('ink-cost')
    };
    if (!refill.color || refill.cost <= 0) return alert('Вкажіть колір та вартість');
    db.inkRefills.push(refill);
    saveDB(db);
    renderInkRefills(db);
  }
  
  function deleteInkRefill(id) {
    var db = getDB();
    db.inkRefills = (db.inkRefills||[]).filter(function(r){ return r.id !== id; });
    saveDB(db);
    renderInkRefills(db);
  }
  
  function renderInkRefills(db) {
    var list = document.getElementById('ink-refills-list');
    if (!list) return;
    var refills = (db.inkRefills||[]).slice().reverse();
    var totalCost = refills.reduce(function(s,r){ return s + (r.cost||0); }, 0);
  
    if (refills.length === 0) {
      list.innerHTML = '<p class="text-muted" style="font-size:13px;">Немає записів</p>';
      return;
    }
  
    var colorEmoji = { 'Чорний':'⬛', 'Голубий':'🟦', 'Пурпурний':'🟪', 'Жовтий':'🟨', 'Світло-голубий':'🔵', 'Світло-пурпурний':'🟣', 'Червоний':'🟥', 'Сірий':'⬜' };
    list.innerHTML = '<div style="font-size:13px;font-weight:600;margin-bottom:6px;">Витрачено на чорнила: <span class="text-danger">' + fmt(totalCost) + ' грн</span> (' + refills.length + ' заправок)</div>' +
      '<div style="max-height:200px;overflow-y:auto;">' +
      refills.slice(0,20).map(function(r) {
        return '<div style="display:flex;align-items:center;gap:8px;padding:4px 0;font-size:12px;border-bottom:1px solid rgba(0,0,0,0.04);">' +
          '<span style="min-width:80px;">' + r.date + '</span>' +
          '<span>' + (colorEmoji[r.color]||'🔘') + ' ' + esc(r.color) + '</span>' +
          '<span style="margin-left:auto;font-weight:600;">' + fmt(r.cost) + ' грн</span>' +
          '<button class="btn btn-danger btn-sm" style="padding:1px 6px;font-size:10px;" onclick="deleteInkRefill(\'' + r.id + '\')">✕</button>' +
        '</div>';
      }).join('') +
      (refills.length > 20 ? '<div class="text-muted" style="padding:4px;font-size:11px;">...та ще ' + (refills.length-20) + ' записів</div>' : '') +
      '</div>';
  }
  function getServiceLogs(db) { return db.serviceLog || []; }
  
  function eqServiceStats(eqId, logs) {
    var eqLogs = logs.filter(function(l){ return l.equipmentId===eqId; });
    var total = eqLogs.reduce(function(s,l){ return s+(l.cost||0); },0);
    return { count: eqLogs.length, totalCost: total };
  }
  
  // ==================== EXPENSES (OpEx) ====================
  // → винесено в public/js/expenses.js (populateExpenseCatSelects, openExpenseModal,
  //   saveExpense, deleteExpense, openExpenseTemplateModal, saveExpenseTemplate,
  //   deleteExpenseTemplate, quickAddFromTemplate, computeTaxForMonth, renderExpenses)
  
  
  function renderEquipment() {
    var db = getDB();
    var items = db.equipment || [];
    var logs = getServiceLogs(db);
    var today = new Date();
    today.setHours(0,0,0,0);
    var alerts = [];
  
    // Summary cards
    var totalValue = items.reduce(function(s,eq){ return s+(eq.price||0); },0);
    var totalServiceCost = logs.reduce(function(s,l){ return s+(l.cost||0); },0);
    var needService = 0;
  
    var rows = items.map(function(eq) {
      var stats = eqServiceStats(eq.id, logs);
      var nextService = '';
      var statusBadge = eq.noService ? '<span class="text-muted">—</span>' : '<span class="badge badge-ok">OK</span>';
      var consumableInfo = [];
      if (!eq.noService && eq.serviceInterval && eq.serviceInterval > 0) {
        var lastDate = eq.lastService ? new Date(eq.lastService) : (eq.purchaseDate ? new Date(eq.purchaseDate) : null);
        if (lastDate) {
          var next = new Date(lastDate);
          next.setDate(next.getDate() + eq.serviceInterval);
          nextService = next.toISOString().slice(0,10);
          var daysLeft = Math.ceil((next - today) / (1000*60*60*24));
          if (daysLeft < 0) {
            statusBadge = '<span class="badge badge-danger">Прострочено</span>';
            alerts.push('⚠️ <b>'+esc(eq.name)+'</b> — обслуговування прострочено на '+Math.abs(daysLeft)+' дн.');
            needService++;
          } else if (daysLeft <= 14) {
            statusBadge = '<span class="badge badge-warning">Скоро</span>';
            alerts.push('🔔 <b>'+esc(eq.name)+'</b> — обслуговування через '+daysLeft+' дн.');
            needService++;
          }
        }
      }
      // Consumables: find last log entry of each type for this equipment
      function lastLogDate(eqId, type) {
        var found = null;
        logs.forEach(function(l){ if(l.equipmentId===eqId && l.type===type && (!found || l.date>found)) found=l.date; });
        return found;
      }
      // Knife
      if (!eq.noService && eq.knifeInterval && eq.knifeInterval > 0) {
        var kLastStr = lastLogDate(eq.id, 'Заміна ножа') || eq.purchaseDate;
        if (kLastStr) {
          var kLast = new Date(kLastStr);
          var kNext = new Date(kLast); kNext.setDate(kNext.getDate() + eq.knifeInterval);
          var kDays = Math.ceil((kNext - today) / (1000*60*60*24));
          if (kDays < 0) { consumableInfo.push('<span class="badge badge-danger">Ніж: прострочено '+Math.abs(kDays)+' дн.</span>'); alerts.push('🔪 <b>'+esc(eq.name)+'</b> — заміна ножа прострочена на '+Math.abs(kDays)+' дн.'); needService++; }
          else if (kDays <= 14) { consumableInfo.push('<span class="badge badge-warning">Ніж: через '+kDays+' дн.</span>'); alerts.push('🔪 <b>'+esc(eq.name)+'</b> — заміна ножа через '+kDays+' дн.'); }
          else { consumableInfo.push('<span style="font-size:11px;color:var(--text-light);">Ніж: '+kNext.toISOString().slice(0,10)+'</span>'); }
        }
      }
      // Mat
      if (!eq.noService && eq.matInterval && eq.matInterval > 0) {
        var mLastStr = lastLogDate(eq.id, 'Заміна килимка') || eq.purchaseDate;
        if (mLastStr) {
          var mLast = new Date(mLastStr);
          var mNext = new Date(mLast); mNext.setDate(mNext.getDate() + eq.matInterval);
          var mDays = Math.ceil((mNext - today) / (1000*60*60*24));
          if (mDays < 0) { consumableInfo.push('<span class="badge badge-danger">Килимок: прострочено '+Math.abs(mDays)+' дн.</span>'); alerts.push('🟫 <b>'+esc(eq.name)+'</b> — заміна килимка прострочена на '+Math.abs(mDays)+' дн.'); needService++; }
          else if (mDays <= 14) { consumableInfo.push('<span class="badge badge-warning">Килимок: через '+mDays+' дн.</span>'); alerts.push('🟫 <b>'+esc(eq.name)+'</b> — заміна килимка через '+mDays+' дн.'); }
          else { consumableInfo.push('<span style="font-size:11px;color:var(--text-light);">Килимок: '+mNext.toISOString().slice(0,10)+'</span>'); }
        }
      }
      var serviceBtn = eq.noService ? '' : '<button class="btn btn-success btn-sm" onclick="openServiceLog(\''+eq.id+'\')" title="Записати обслуговування">🔧</button> ';
      return '<tr>'+
        '<td data-label="Назва"><b>'+esc(eq.name)+'</b></td>'+
        '<td data-label="Категорія">'+esc(eq.category||'')+'</td>'+
        '<td data-label="Дата покупки">'+(eq.purchaseDate||'—')+'</td>'+
        '<td data-label="Вартість">'+(eq.price ? fmt(eq.price)+' грн' : '—')+'</td>'+
        '<td data-label="Обслуговувань">'+(eq.noService ? '—' : stats.count)+'</td>'+
        '<td data-label="Витрати">'+(eq.noService ? '—' : (stats.totalCost ? fmt(stats.totalCost)+' грн' : '—'))+'</td>'+
        '<td data-label="Наступне ТО">'+(eq.noService ? '—' : (nextService||'—'))+'</td>'+
        '<td data-label="Статус">'+statusBadge+(consumableInfo.length ? '<div style="margin-top:4px;">'+consumableInfo.join(' ')+'</div>' : '')+'</td>'+
        '<td data-label="Нотатки" style="max-width:200px;font-size:12px;color:var(--text-light);">'+esc(eq.note||'')+'</td>'+
        '<td data-label="Дії" style="white-space:nowrap;text-align:right;">'+
          serviceBtn+
          '<button class="btn btn-outline btn-sm" onclick="editEquipment(\''+eq.id+'\')" title="Редагувати">✏️</button> '+
          '<button class="btn btn-danger btn-sm" onclick="deleteEquipment(\''+eq.id+'\')" title="Видалити">✕</button>'+
        '</td></tr>';
    }).join('');
  
    document.getElementById('equipment-cards').innerHTML =
      '<div class="card"><div class="card-label">Всього обладнання</div><div class="card-value">'+items.length+'</div></div>'+
      '<div class="card"><div class="card-label">Загальна вартість</div><div class="card-value">'+fmt(totalValue)+'</div><div class="card-sub">грн</div></div>'+
      '<div class="card'+(totalServiceCost>0?' warning':'')+'"><div class="card-label">Витрати на обслуговування</div><div class="card-value">'+fmt(totalServiceCost)+'</div><div class="card-sub">грн за весь час</div></div>'+
      '<div class="card'+(needService>0?' danger':'success')+'"><div class="card-label">Потребують обслуговування</div><div class="card-value">'+needService+'</div></div>';
  
    document.getElementById('equipment-table').innerHTML = rows || '<tr><td colspan="10" style="text-align:center;padding:40px;color:var(--text-light);">Додайте своє перше обладнання</td></tr>';
    document.getElementById('equipment-alerts').innerHTML = alerts.map(function(a){ return '<div class="alert alert-warning">'+a+'</div>'; }).join('');
  
    // Service history table with filter
    var eqMap = {};
    items.forEach(function(eq){ eqMap[eq.id] = eq.name; });
    var filterEl = document.getElementById('eq-history-filter');
    var curFilter = filterEl.value;
    var opts = '<option value="">Все обладнання</option>' + items.filter(function(eq){ return !eq.noService; }).map(function(eq){ return '<option value="'+eq.id+'"'+(curFilter===eq.id?' selected':'')+'>'+esc(eq.name)+'</option>'; }).join('');
    filterEl.innerHTML = opts;
    var sortedLogs = logs.slice().sort(function(a,b){ return b.date>a.date?1:(b.date<a.date?-1:0); });
    if (curFilter) sortedLogs = sortedLogs.filter(function(l){ return l.equipmentId===curFilter; });
    var historyRows = sortedLogs.map(function(l){
      return '<tr>'+
        '<td data-label="Дата">'+esc(l.date||'')+'</td>'+
        '<td data-label="Обладнання">'+esc(eqMap[l.equipmentId]||'Видалено')+'</td>'+
        '<td data-label="Тип">'+esc(l.type||'')+'</td>'+
        '<td data-label="Вартість">'+(l.cost ? fmt(l.cost)+' грн' : '—')+'</td>'+
        '<td data-label="Коментар">'+esc(l.comment||'')+'</td>'+
        '<td data-label="Дії" style="white-space:nowrap;text-align:right;"><button class="btn btn-outline btn-sm" onclick="editServiceLog(\''+l.id+'\')" title="Редагувати">✏️</button> <button class="btn btn-danger btn-sm" onclick="deleteServiceLog(\''+l.id+'\')">✕</button></td>'+
      '</tr>';
    }).join('');
    document.getElementById('service-history-table').innerHTML = historyRows || '<tr><td colspan="6" style="text-align:center;padding:20px;color:var(--text-light);">Поки немає записів</td></tr>';
  }
  
  // ==================== INVOICE OCR ====================
  // → винесено в public/js/invoice-ocr.js (uploadInvoice, renderInvoiceItems,
  //   toggleInvAction, recalcInvItem, applyInvoiceItems, undoLastInvoice).
  // window._invoiceItems / _invoiceNumber / _lastInvoiceUndo — state на window
  
  
  function toggleInkSection() {
    var isInk = document.getElementById('svc-type').value === 'Заправка чорнил';
    document.getElementById('svc-ink-section').style.display = isInk ? 'block' : 'none';
  }
  
  function clearInkFields() {
    ['svc-ink-c','svc-ink-m','svc-ink-y','svc-ink-bk','svc-ink-lc','svc-ink-lm'].forEach(function(id){ document.getElementById(id).value = ''; });
    document.getElementById('svc-ink-total').textContent = '';
  }
  
  function calcInkCost() {
    var db = getDB();
    var costPerMl = (db.printerSettings||{}).inkCostPerMl || 0;
    var totalMl = 0;
    ['svc-ink-c','svc-ink-m','svc-ink-y','svc-ink-bk','svc-ink-lc','svc-ink-lm'].forEach(function(id){
      totalMl += parseInt(document.getElementById(id).value) || 0;
    });
    var el = document.getElementById('svc-ink-total');
    if (totalMl > 0 && costPerMl > 0) {
      var total = totalMl * costPerMl;
      el.innerHTML = 'Всього: ' + totalMl + ' мл × ' + fmt(costPerMl) + ' грн = <b>' + fmt(total) + ' грн</b>';
      document.getElementById('svc-cost').value = Math.round(total * 100) / 100;
    } else if (totalMl > 0) {
      el.innerHTML = 'Всього: ' + totalMl + ' мл <span style="color:var(--text-light);">(вкажіть ціну за мл в Налаштуваннях → Принтер)</span>';
    } else {
      el.textContent = '';
    }
  }
  
  function populateSvcEquipmentSelect(selectedId) {
    var db = getDB();
    var items = (db.equipment||[]).filter(function(eq){ return !eq.noService; });
    var sel = document.getElementById('svc-eq-id');
    sel.innerHTML = items.map(function(eq){ return '<option value="'+eq.id+'"'+(eq.id===selectedId?' selected':'')+'>'+esc(eq.name)+'</option>'; }).join('');
  }
  
  var _svcEditId = '';
  
  function openServiceLog(eqId) {
    _svcEditId = '';
    populateSvcEquipmentSelect(eqId);
    document.getElementById('svc-date').value = new Date().toISOString().slice(0,10);
    document.getElementById('svc-cost').value = '0';
    document.getElementById('svc-comment').value = '';
    document.getElementById('svc-type').value = 'Планове обслуговування';
    clearInkFields(); toggleInkSection();
    openModal('log-service');
  }
  
  function openServiceLogFromHistory() {
    _svcEditId = '';
    var filter = document.getElementById('eq-history-filter').value;
    populateSvcEquipmentSelect(filter);
    document.getElementById('svc-date').value = new Date().toISOString().slice(0,10);
    document.getElementById('svc-cost').value = '0';
    document.getElementById('svc-comment').value = '';
    document.getElementById('svc-type').value = 'Планове обслуговування';
    clearInkFields(); toggleInkSection();
    openModal('log-service');
  }
  
  function editServiceLog(id) {
    var db = getDB();
    var entry = (db.serviceLog||[]).find(function(x){ return x.id===id; });
    if (!entry) return;
    _svcEditId = id;
    populateSvcEquipmentSelect(entry.equipmentId);
    document.getElementById('svc-date').value = entry.date||'';
    document.getElementById('svc-type').value = entry.type||'Планове обслуговування';
    document.getElementById('svc-cost').value = entry.cost||0;
    document.getElementById('svc-comment').value = entry.comment||'';
    clearInkFields(); toggleInkSection();
    openModal('log-service');
  }
  
  function saveServiceLog() {
    var db = getDB();
    if (!db.serviceLog) db.serviceLog = [];
    var eqId = document.getElementById('svc-eq-id').value;
    if (!eqId) return alert('Оберіть обладнання');
    var type = v('svc-type');
    var comment = v('svc-comment');
    // Build ink details
    if (type === 'Заправка чорнил') {
      var inks = [];
      var inkIds = {c:'C',m:'M',y:'Y',bk:'BK',lc:'LC',lm:'LM'};
      Object.keys(inkIds).forEach(function(k){
        var val = parseInt(document.getElementById('svc-ink-'+k).value) || 0;
        if (val > 0) inks.push(inkIds[k]+': '+val+' мл');
      });
      if (inks.length) comment = inks.join(', ') + (comment ? '. ' + comment : '');
    }
    var entry = {
      id: _svcEditId || uid(),
      equipmentId: eqId,
      date: v('svc-date'),
      type: type,
      cost: n('svc-cost'),
      comment: comment
    };
    if (!entry.date) return alert('Вкажіть дату');
    if (_svcEditId) {
      var idx = db.serviceLog.findIndex(function(x){ return x.id===_svcEditId; });
      if (idx >= 0) db.serviceLog[idx] = entry;
    } else {
      db.serviceLog.push(entry);
    }
    // Update lastService on the equipment (for general service tracking)
    var eq = (db.equipment||[]).find(function(x){ return x.id===eqId; });
    if (eq && entry.type !== 'Заміна ножа' && entry.type !== 'Заміна килимка' && entry.type !== 'Заправка чорнил') {
      eq.lastService = entry.date;
    }
    saveDB(db);
    closeModal('log-service');
    renderPage('equipment');
  }
  
  function deleteServiceLog(id) {
    if (!confirm('Видалити запис обслуговування?')) return;
    var db = getDB();
    db.serviceLog = (db.serviceLog||[]).filter(function(x){ return x.id!==id; });
    saveDB(db);
    renderPage('equipment');
  }
  
  function toggleEqService() {
    var noService = document.getElementById('eq-no-service').checked;
    document.getElementById('eq-service-fields').style.display = noService ? 'none' : 'block';
  }
  
  function saveEquipment() {
    var db = getDB();
    if (!db.equipment) db.equipment = [];
    var editId = document.getElementById('eq-edit-id').value;
    var noService = document.getElementById('eq-no-service').checked;
    var eq = {
      id: editId || uid(),
      name: v('eq-name'),
      category: v('eq-category'),
      purchaseDate: v('eq-purchase-date'),
      price: n('eq-price'),
      noService: noService,
      serviceInterval: noService ? 0 : (parseInt(document.getElementById('eq-service-interval').value)||0),
      lastService: noService ? '' : v('eq-last-service'),
      knifeInterval: noService ? 0 : (parseInt(document.getElementById('eq-knife-interval').value)||0),
      matInterval: noService ? 0 : (parseInt(document.getElementById('eq-mat-interval').value)||0),
      note: v('eq-note')
    };
    if (!eq.name) return alert('Введіть назву обладнання');
    if (editId) {
      var existing = db.equipment.find(function(x){ return x.id===editId; });
      if (existing) eq.lastService = eq.lastService || existing.lastService;
      var idx = db.equipment.findIndex(function(x){ return x.id===editId; });
      if (idx>=0) db.equipment[idx] = eq;
    } else {
      db.equipment.push(eq);
    }
    saveDB(db);
    closeModal('add-equipment');
    clearEquipmentForm();
    renderPage('equipment');
  }
  
  function editEquipment(id) {
    var db = getDB();
    var eq = (db.equipment||[]).find(function(x){ return x.id===id; });
    if (!eq) return;
    document.getElementById('eq-modal-title').textContent = 'Редагувати обладнання';
    document.getElementById('eq-edit-id').value = eq.id;
    document.getElementById('eq-name').value = eq.name||'';
    document.getElementById('eq-category').value = eq.category||'Інше';
    document.getElementById('eq-purchase-date').value = eq.purchaseDate||'';
    document.getElementById('eq-price').value = eq.price||0;
    document.getElementById('eq-no-service').checked = !!eq.noService;
    document.getElementById('eq-service-fields').style.display = eq.noService ? 'none' : 'block';
    document.getElementById('eq-service-interval').value = eq.serviceInterval||180;
    document.getElementById('eq-last-service').value = eq.lastService||'';
    document.getElementById('eq-knife-interval').value = eq.knifeInterval||0;
    document.getElementById('eq-mat-interval').value = eq.matInterval||0;
    document.getElementById('eq-note').value = eq.note||'';
    openModal('add-equipment');
  }
  
  function deleteEquipment(id) {
    if (!confirm('Видалити це обладнання?')) return;
    var db = getDB();
    db.equipment = (db.equipment||[]).filter(function(x){ return x.id!==id; });
    saveDB(db);
    renderPage('equipment');
  }
  
  function clearEquipmentForm() {
    document.getElementById('eq-modal-title').textContent = 'Додати обладнання';
    document.getElementById('eq-edit-id').value = '';
    document.getElementById('eq-name').value = '';
    document.getElementById('eq-category').value = 'Друк';
    document.getElementById('eq-purchase-date').value = '';
    document.getElementById('eq-price').value = '0';
    document.getElementById('eq-no-service').checked = false;
    document.getElementById('eq-service-fields').style.display = 'block';
    document.getElementById('eq-service-interval').value = '180';
    document.getElementById('eq-last-service').value = '';
    document.getElementById('eq-knife-interval').value = '0';
    document.getElementById('eq-mat-interval').value = '0';
    document.getElementById('eq-note').value = '';
  }

  window.savePrinterSettings = savePrinterSettings;
  window.recalcPrintCost = recalcPrintCost;
  window.overrideCostPerPage = overrideCostPerPage;
  window.overrideInkCostMl = overrideInkCostMl;
  window.addInkRefill = addInkRefill;
  window.deleteInkRefill = deleteInkRefill;
  window.renderInkRefills = renderInkRefills;
  window.getServiceLogs = getServiceLogs;
  window.eqServiceStats = eqServiceStats;
  window.renderEquipment = renderEquipment;
  window.toggleInkSection = toggleInkSection;
  window.clearInkFields = clearInkFields;
  window.calcInkCost = calcInkCost;
  window.populateSvcEquipmentSelect = populateSvcEquipmentSelect;
  window.openServiceLog = openServiceLog;
  window.openServiceLogFromHistory = openServiceLogFromHistory;
  window.editServiceLog = editServiceLog;
  window.saveServiceLog = saveServiceLog;
  window.deleteServiceLog = deleteServiceLog;
  window.toggleEqService = toggleEqService;
  window.saveEquipment = saveEquipment;
  window.editEquipment = editEquipment;
  window.deleteEquipment = deleteEquipment;
  window.clearEquipmentForm = clearEquipmentForm;
})();
