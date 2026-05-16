// ============================================================
// LipoLand — Settings page module
// ============================================================
// renderSettings (вся сторінка налаштувань), taxSettings, workers CRUD.

(function(){
  'use strict';

  // ==================== SETTINGS ====================
  function renderSettings() {
    var db = getDB();
    // PWA install state
    try {
      var standalone = window._isStandalonePWA || (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);
      var statusBox = document.getElementById('pwa-status-box');
      var installBtn = document.getElementById('pwa-install-btn');
      if (statusBox && installBtn) {
        if (standalone) {
          statusBox.style.display = 'block';
          installBtn.style.display = 'none';
        } else if (window._deferredInstallPrompt) {
          installBtn.style.display = 'inline-flex';
        }
      }
      // Push status
      if (typeof refreshPushUI === 'function') refreshPushUI();
    } catch(_) {}
    document.getElementById('workers-list').innerHTML = db.workers.map(function(w,i){
      return '<div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid var(--border);">'+
        '<span style="flex:1;">'+esc(w)+'</span>'+
        '<button class="btn btn-danger btn-sm" onclick="removeWorker('+i+')">&#x2715;</button></div>';
    }).join('') || '<p class="text-muted">Додайте майстрів</p>';
    // Render feature toggles in settings
    renderSettingsFeatures();
    // Load CRM settings from server
    loadCrmSettings();
    // Load printer settings
    var ps = db.printerSettings || {};
    var colorsEl = document.getElementById('printer-colors');
    if (colorsEl) colorsEl.value = ps.colors || 6;
    document.getElementById('printer-refill-price').value = ps.refillPrice || '';
    document.getElementById('printer-refill-volume').value = ps.refillVolumeMl || '';
    var mlPerPageEl = document.getElementById('printer-ml-per-page');
    if (mlPerPageEl) mlPerPageEl.value = ps.mlPerPage || '';
    document.getElementById('printer-cost-per-page').value = ps.costPerPageA4 || 0;
    document.getElementById('printer-ink-cost-ml').value = ps.inkCostPerMl || 0;
    document.getElementById('printer-cost-per-page-manual').value = ps.costPerPageA4 || '';
    document.getElementById('printer-ink-cost-ml-manual').value = ps.inkCostPerMl || '';
    recalcPrintCost();
    // Load default worker rate
    var dr = db.workerRateDefault || { type:'percent', value:25 };
    document.getElementById('default-rate-type').value = dr.type || 'percent';
    document.getElementById('default-rate-value').value = dr.value || 25;
    // Load linked workers
    if (!_currentUser || !_currentUser.isWorker) loadLinkedWorkers();
    // Load notification preferences
    loadNotifPrefs();
    // Load tax settings
    loadTaxSettings();
  }
  
  function loadTaxSettings() {
    var db = getDB();
    var ts = db.taxSettings || {};
    var sel = document.getElementById('tax-fop-group');
    if (!sel) return;
    sel.value = ts.fopGroup || 'none';
    document.getElementById('tax-fop-group2-amount').value = ts.fopGroup2Amount != null ? ts.fopGroup2Amount : 3000;
    document.getElementById('tax-fop-group3-rate').value = ts.fopGroup3Rate != null ? ts.fopGroup3Rate : 5;
    document.getElementById('tax-military-rate').value = ts.militaryRate != null ? ts.militaryRate : 1;
    onFopGroupChange();
  }
  
  function onFopGroupChange() {
    var v2 = document.getElementById('tax-fop-group').value;
    document.getElementById('tax-fop-group2-fields').style.display = (v2==='group2') ? 'flex' : 'none';
    document.getElementById('tax-fop-group3-fields').style.display = (v2==='group3') ? 'block' : 'none';
    var prev = document.getElementById('tax-preview');
    if (v2 === 'group2') {
      var amt = parseFloat(document.getElementById('tax-fop-group2-amount').value)||0;
      prev.innerHTML = '💡 Кожен місяць в P&L буде враховано <strong>'+fmt(amt)+' грн</strong> податку (фіксовано). Можна перевизначити суму для конкретного місяця у «Витрати».';
    } else if (v2 === 'group3') {
      var r = parseFloat(document.getElementById('tax-fop-group3-rate').value)||0;
      var m = parseFloat(document.getElementById('tax-military-rate').value)||0;
      prev.innerHTML = '💡 Податок = (виручка × '+r+'%) + (виручка × '+m+'%) = <strong>виручка × '+(r+m).toFixed(1)+'%</strong>. Рахується автоматично за кожен місяць.';
    } else {
      prev.innerHTML = '✅ <strong>Податки не рахуються автоматично.</strong> У P&L рядок «Податки» буде 0 грн. Якщо колись заплатиш якийсь податок (наприклад ПДФО з виведення коштів) — просто додай разову витрату в категорії «🧾 Податки».';
    }
  }
  
  function saveTaxSettings() {
    var db = getDB();
    if (!db.taxSettings) db.taxSettings = {};
    db.taxSettings.fopGroup = v('tax-fop-group');
    db.taxSettings.fopGroup2Amount = n('tax-fop-group2-amount');
    db.taxSettings.fopGroup3Rate = n('tax-fop-group3-rate');
    db.taxSettings.militaryRate = n('tax-military-rate');
    if (!db.taxSettings.monthOverrides) db.taxSettings.monthOverrides = {};
    saveDB(db);
    var saved = document.getElementById('tax-settings-saved');
    saved.style.display='inline';
    setTimeout(function(){ saved.style.display='none'; }, 2000);
    onFopGroupChange();
  }
  
  // Re-render preview when user edits fields
  document.addEventListener('input', function(e) {
    if (e.target && (e.target.id === 'tax-fop-group2-amount' || e.target.id === 'tax-fop-group3-rate' || e.target.id === 'tax-military-rate')) {
      onFopGroupChange();
    }
  });
  
  function addWorker() {
    var name = v('new-worker').trim();
    if(!name) return;
    var db = getDB();
    db.workers.push(name);
    saveDB(db);
    document.getElementById('new-worker').value='';
    renderSettings();
  }
  
  function removeWorker(i) {
    var db = getDB();
    db.workers.splice(i,1);
    saveDB(db);
    renderSettings();
  }

  window.renderSettings = renderSettings;
  window.loadTaxSettings = loadTaxSettings;
  window.onFopGroupChange = onFopGroupChange;
  window.saveTaxSettings = saveTaxSettings;
  window.addWorker = addWorker;
  window.removeWorker = removeWorker;
})();
