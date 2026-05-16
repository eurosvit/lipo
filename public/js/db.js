// ============================================================
// LipoLand — Data Layer module (SYNC)
// ============================================================
// getDB/saveDB/_doSyncSave/_retrySaveNow/_updateSaveIndicator/
// getAllWorkerNames + INIT-fetch ланцюжок (auth/me + /api/data).
// Все на window — інші модулі звертаються як простий identifier.
// SYNC (без defer): інші модулі викликають getDB одразу в IIFE.

(function(){
  'use strict';

  window.DB_KEY = 'toy_inventory_db';
  window._dbCache = null;

  function getDB() {
    var def = { materials:[], products:[], production:[], orders:[], workers:['Майстер 1'], nextOrderNum:1, workerStock:[], workerStockHistory:[], equipment:[], serviceLog:[], printerSettings:{ colors:6, costPerPageA4:0 }, inkRefills:[], consumables:[], workerRateDefault:{ type:'percent', value:25 }, packagingKits:[], orderChannels:['Instagram','Рекомендація','Etsy','Сайт','Інше'], salaryPayments:[], expenses:[], expenseTemplates:[], expenseCategories:['📦 Закупка матеріалів','🏠 Оренда та комуналка','📢 Реклама','💳 Підписки','📱 Зв\'язок / інтернет','📦 Доставка','🧾 Податки','🔧 Інше'], taxSettings:{ fopGroup:'none', fopGroup2Amount:3000, fopGroup3Rate:5, militaryRate:1, monthOverrides:{} }, orderStatuses:[{id:'new',label:'🆕 Новий',color:'#ffeaa7'},{id:'in_production',label:'🔧 На виробництві',color:'#81ecec'},{id:'shipped',label:'📦 Відправлено',color:'#a29bfe'},{id:'completed',label:'✔ Виконано',color:'#55efc4'}], clientMeta:{}, defects:[], auditLog:[], inventoryAudits:[] };
    if (window._dbCache) return Object.assign({}, def, window._dbCache);
    try {
      var d = JSON.parse(localStorage.getItem(window.DB_KEY));
      return d ? Object.assign({}, def, d) : def;
    } catch (e) { return def; }
  }

  // ---- Reliable save: track dirty state + sync retry + beforeunload beacon ----
  window._saveDirty = false;
  window._saveInFlight = false;
  window._saveRetryTimer = null;
  window._saveBackoffMs = 3000;       // поточна пауза між ретраями (зростає експоненційно)
  window._saveBackoffMax = 60000;     // максимум 60с
  window._saveAuthFailed = false;     // якщо сесія померла — не мучимо сервер
  window._saveLastError = null;       // для діагностики через клік на індикаторі

  function _doSyncSave(db, isRetry) {
    if (window._saveAuthFailed) { _updateSaveIndicator('auth-error'); return Promise.resolve(); }
    window._saveInFlight = true;
    _updateSaveIndicator('saving');
    var bodyStr = JSON.stringify(db);
    var useKeepalive = bodyStr.length < 60000;
    return fetch('/api/data', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: bodyStr,
      keepalive: useKeepalive
    }).then(function(r){
      if (!r.ok) {
        var err = new Error('HTTP '+r.status);
        err.status = r.status;
        throw err;
      }
      window._saveInFlight = false;
      window._saveDirty = false;
      window._saveBackoffMs = 3000;
      window._saveLastError = null;
      _updateSaveIndicator('saved');
      if (window._saveRetryTimer) { clearTimeout(window._saveRetryTimer); window._saveRetryTimer = null; }
    }).catch(function(err){
      window._saveInFlight = false;
      window._saveLastError = err;
      console.warn('[lipo] save failed:', err && err.message, err);
      if (err && err.status === 401) {
        window._saveAuthFailed = true;
        _updateSaveIndicator('auth-error');
        return;
      }
      _updateSaveIndicator('error');
      if (window._saveRetryTimer) clearTimeout(window._saveRetryTimer);
      var delay = window._saveBackoffMs;
      window._saveBackoffMs = Math.min(window._saveBackoffMs * 2, window._saveBackoffMax);
      window._saveRetryTimer = setTimeout(function(){
        if (window._saveDirty && !window._saveAuthFailed) {
          var latest = JSON.parse(localStorage.getItem(window.DB_KEY) || 'null');
          if (latest) _doSyncSave(latest, true);
        }
      }, delay);
    });
  }

  function _retrySaveNow() {
    if (window._saveAuthFailed) {
      if (confirm('Сесія завершена. Перейти на сторінку входу? (дані у цьому вкладенні залишаться)')) {
        window.location.href = '/login?return=' + encodeURIComponent(window.location.pathname);
      }
      return;
    }
    if (window._saveRetryTimer) { clearTimeout(window._saveRetryTimer); window._saveRetryTimer = null; }
    window._saveBackoffMs = 3000;
    var latest = JSON.parse(localStorage.getItem(window.DB_KEY) || 'null');
    if (latest) _doSyncSave(latest, false);
  }

  function _updateSaveIndicator(state) {
    var el = document.getElementById('save-indicator');
    if (!el) return;
    var show = function(text, color, bg, clickable) {
      el.textContent = text;
      el.style.color = color;
      el.style.background = bg || 'rgba(255,255,255,0.96)';
      el.style.opacity = '1';
      el.style.cursor = clickable ? 'pointer' : 'default';
      el.style.pointerEvents = clickable ? 'auto' : 'none';
      el.onclick = clickable ? _retrySaveNow : null;
      if (clickable) el.title = 'Натисніть, щоб повторити зараз';
      else el.removeAttribute('title');
    };
    var hide = function(){
      el.style.opacity = '0';
      el.style.pointerEvents = 'none';
      el.onclick = null;
      setTimeout(function(){ if (el.style.opacity === '0') el.textContent = ''; }, 250);
    };
    if (state === 'saving') { show('⏳ Збереження...', '#999'); }
    else if (state === 'saved') {
      show('✓ Збережено', '#4CAF50');
      setTimeout(function(){ if (el.textContent === '✓ Збережено') hide(); }, 1500);
    }
    else if (state === 'auth-error') {
      show('🔑 Сесія завершена — увійти', '#fff', '#E53935', true);
    }
    else if (state === 'error') {
      show('⚠ Не збережено — повторити', '#E53935', '#FFEBEE', true);
    }
    else { hide(); }
  }

  function saveDB(db) {
    db._updatedAt = Date.now();
    window._dbCache = db;
    localStorage.setItem(window.DB_KEY, JSON.stringify(db));
    window._saveDirty = true;
    _doSyncSave(db, false);
    if (typeof window.updateNotifications === 'function') window.updateNotifications();
  }

  // Safety net: send beacon on tab close if save pending
  window.addEventListener('beforeunload', function() {
    if (window._saveDirty) {
      try {
        var db = JSON.parse(localStorage.getItem(window.DB_KEY) || 'null');
        if (db && navigator.sendBeacon) {
          var blob = new Blob([JSON.stringify(db)], { type: 'application/json' });
          navigator.sendBeacon('/api/data', blob);
        }
      } catch(e){}
    }
  });

  function getAllWorkerNames() {
    var db = getDB();
    var names = (db.workers || []).slice();
    (window._linkedWorkerNames || []).forEach(function(n) {
      if (n && names.indexOf(n) === -1) names.push(n);
    });
    return names;
  }

  // Export
  window.getDB = getDB;
  window.saveDB = saveDB;
  window._doSyncSave = _doSyncSave;
  window._retrySaveNow = _retrySaveNow;
  window._updateSaveIndicator = _updateSaveIndicator;
  window.getAllWorkerNames = getAllWorkerNames;

  // ==== INIT-fetch ====
  // /api/auth/me → /api/data → reconcile local vs server → showPage(saved).
  // Загорнуто в DOMContentLoaded, щоб усі defer-модулі вже виконалися
  // (showPage, updateNotifications, loadLinkedWorkers).
  function _runInitFetch() {
    fetch('/api/auth/me').then(function(r){ return r.json(); }).then(function(u){
      var prevUser = localStorage.getItem('lipo_current_user');
      var curUser = u && u.id ? u.id : '';
      if (!prevUser || prevUser !== curUser) {
        // Different user or first login — clear all old data
        localStorage.removeItem(window.DB_KEY);
        localStorage.removeItem(window.SD_SETTINGS_KEY);
        localStorage.removeItem('lipo_read_notifs');
        localStorage.removeItem('lipo_onboarding_done');
        localStorage.removeItem('lipo_features');
        localStorage.removeItem('lipo_features_configured');
        window._dbCache = null;
      }
      if (curUser) localStorage.setItem('lipo_current_user', curUser);
      return fetch('/api/data');
    }).then(function(r){ return r.json(); }).then(function(serverData){
      var localRaw = null;
      try { localRaw = JSON.parse(localStorage.getItem(window.DB_KEY) || 'null'); } catch(e) {}
      var localTs = (localRaw && localRaw._updatedAt) || 0;
      var serverTs = (serverData && serverData._updatedAt) || 0;
      var localHasContent = localRaw && (localRaw.materials || localRaw.products || localRaw.orders);
      var serverHasContent = serverData && (serverData.materials || serverData.products || serverData.orders);

      if (localHasContent && localTs > serverTs) {
        window._dbCache = localRaw;
        window._saveDirty = true;
        _doSyncSave(localRaw, false);
        console.info('[lipo] Local data is newer (ts='+localTs+' vs server '+serverTs+') — pushing up');
      } else if (serverHasContent) {
        // Merge: preserve local worker/note/channel/ttn/tracking on orders
        if (localHasContent && localRaw.orders && serverData.orders) {
          var localMap = {};
          localRaw.orders.forEach(function(o){ if(o.id) localMap[o.id] = o; });
          serverData.orders.forEach(function(o) {
            var loc = localMap[o.id];
            if (loc) {
              if (loc.worker && !o.worker) o.worker = loc.worker;
              if (loc.note && !o.note) o.note = loc.note;
              if (loc.channel && !o.channel) o.channel = loc.channel;
              if (loc.ttn && !o.ttn) o.ttn = loc.ttn;
              if (loc.tracking && !o.tracking) o.tracking = loc.tracking;
            }
          });
        }
        window._dbCache = serverData;
        localStorage.setItem(window.DB_KEY, JSON.stringify(serverData));
      }
      try {
        var cur = window._dbCache;
        if (cur) cur._migratedOrderAutoProduction = true;
      } catch(e){}
      var _savedPage = localStorage.getItem('lipo_current_page') || 'dashboard';
      if (typeof window.showPage === 'function') window.showPage(_savedPage);
      if (typeof window.updateNotifications === 'function') window.updateNotifications();
      if (!window._currentUser || !window._currentUser.isWorker) {
        try { if (typeof window.loadLinkedWorkers === 'function') window.loadLinkedWorkers(); } catch(e) {}
      }
    }).catch(function(){
      var _savedPage = localStorage.getItem('lipo_current_page') || 'dashboard';
      if (typeof window.showPage === 'function') window.showPage(_savedPage);
      if (!window._currentUser || !window._currentUser.isWorker) {
        try { if (typeof window.loadLinkedWorkers === 'function') window.loadLinkedWorkers(); } catch(e) {}
      }
    });
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _runInitFetch);
  } else {
    _runInitFetch();
  }
})();
