// ============================================================
// LipoLand — Nova Poshta tracking module
// ============================================================
// Опитування статусів ТТН через /api/np/track, авто-синхронізація
// статусу замовлення з статусом доставки (returned/completed/shipped).
// Глобали: getDB, saveDB, esc, getOrderStatuses, renderOrders.

(function(){
  'use strict';

  // ==================== NOVA POSHTA TRACKING ====================
  // Mapping status code → visual bucket (колір/емодзі/лейбл)
  // Ref: https://devcenter.novaposhta.ua/docs/services/...
  function statusToVisualNP(statusCode) {
    var sc = parseInt(statusCode, 10) || 0;
    if (sc === 9 || sc === 10 || sc === 11) return { emoji:'✅', color:'#2E7D32', bg:'#E8F5E9', label:'Вручено' };
    if (sc === 7 || sc === 8)               return { emoji:'📮', color:'#E65100', bg:'#FFF3E0', label:'У відділенні' };
    if (sc === 5 || sc === 6)               return { emoji:'🚚', color:'#1565C0', bg:'#E3F2FD', label:'У дорозі' };
    if (sc === 4)                           return { emoji:'📦', color:'#1565C0', bg:'#E3F2FD', label:'Прийнято' };
    if (sc === 1 || sc === 2 || sc === 3)   return { emoji:'🏷', color:'#616161', bg:'#F5F5F5', label:'Створено' };
    if (sc === 102 || sc === 103)           return { emoji:'↩', color:'#C62828', bg:'#FFEBEE', label:'Повернення' };
    if (sc === 111 || sc === 14)            return { emoji:'❌', color:'#C62828', bg:'#FFEBEE', label:'Скасовано' };
    return null;
  }
  
  // Синхронізація статусу замовлення на основі трекінгу НП
  function syncOrderStatusFromTracking(order) {
    if (!order.tracking) return false;
    var rawSc = order.tracking.statusCode != null ? order.tracking.statusCode : order.tracking.StatusCode;
    if (rawSc == null || rawSc === '') return false;
    var sc = parseInt(rawSc, 10) || 0;
    var statuses = getOrderStatuses();
    var hasStatus = function(id) { return statuses.some(function(s){ return s.id === id; }); };
    var oldStatus = order.status;
    // Повернення (102,103) → returned
    if ((sc === 102 || sc === 103) && hasStatus('returned')) {
      order.status = 'returned';
    }
    // Вручено (9,10,11) → completed
    else if ((sc === 9 || sc === 10 || sc === 11) && hasStatus('completed')) {
      order.status = 'completed';
    }
    // У відділенні (7,8) або У дорозі (5,6) або Прийнято (4) → shipped
    else if ((sc >= 4 && sc <= 8) && hasStatus('shipped')) {
      order.status = 'shipped';
    }
    // Створено (1,2,3) → не змінюємо (ТТН створена але ще не відправлена)
    return order.status !== oldStatus;
  }
  
  // True для ТТН що схожа на Нову Пошту (13-14 цифр).
  function ttnLooksLikeNP(ttn) {
    return /^\d{13,14}$/.test(String(ttn||'').trim());
  }
  
  // Батчингом тягнемо статуси НП для замовлень з TTN.
  // opts.force=true — ігнорує throttle І фільтр carrier (пробуємо ВСЕ з ТТН)
  function trackNpOrders(opts) {
    opts = opts || {};
    var db = getDB();
    var list = db.orders || [];
    var nowMs = Date.now();
    var THROTTLE_MS = 30*60*1000;
    var DELIVERED_HOLD_MS = 24*60*60*1000;
  
    var needFetch = [];
    var skippedNoTtn = 0;
    var skippedNotNp = 0;
    var skippedThrottle = 0;
    list.forEach(function(o){
      if (!o.ttn) { skippedNoTtn++; return; }
      // У force-режимі (ручна кнопка) пробуємо всі ТТН без фільтрів.
      // В авто-режимі — тільки carrier='nova' або числовий формат НП.
      if (!opts.force) {
        var isNp = (o.carrier === 'nova') || (!o.carrier && ttnLooksLikeNP(o.ttn));
        if (!isNp) { skippedNotNp++; return; }
      }
      var tr = o.tracking;
      if (!opts.force && tr && tr.updatedAt) {
        var updMs = Date.parse(tr.updatedAt) || 0;
        var isDelivered = tr.statusCode === 9 || tr.statusCode === 10 || tr.statusCode === 11;
        var hold = isDelivered ? DELIVERED_HOLD_MS : THROTTLE_MS;
        if (nowMs - updMs < hold) { skippedThrottle++; return; }
      }
      needFetch.push(o.ttn);
    });
  
    console.log('[lipo] NP track: toFetch=%d, noTTN=%d, notNP=%d, throttled=%d, force=%s',
      needFetch.length, skippedNoTtn, skippedNotNp, skippedThrottle, !!opts.force);
  
    if (!needFetch.length) return Promise.resolve({ updated:0, sent:0, total:list.length });
  
    // батч по 100 ТТН на запит
    var chunks = [];
    for (var i=0; i<needFetch.length; i+=100) chunks.push(needFetch.slice(i, i+100));
    var updated = 0;
  
    function runChunk(idx) {
      if (idx >= chunks.length) return Promise.resolve();
      return fetch('/api/np/track', {
        method: 'POST',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ ttns: chunks[idx] })
      }).then(function(r){
        return r.text().then(function(txt){
          var body;
          try { body = JSON.parse(txt); } catch(e){ body = {error: 'non-JSON ('+r.status+')'}; }
          return { status: r.status, body: body };
        });
      }).then(function(wrap){
        if (wrap.status === 501) { var e = new Error('not-configured'); e.code='not-configured'; throw e; }
        if (wrap.status !== 200)  throw new Error(wrap.body.error || ('HTTP '+wrap.status));
        var db2 = getDB();
        var results = wrap.body.results || {};
        (db2.orders||[]).forEach(function(o){
          if (!o.ttn || !results[o.ttn]) return;
          o.tracking = results[o.ttn];
          syncOrderStatusFromTracking(o);
          updated++;
        });
        saveDB(db2);
        return runChunk(idx+1);
      });
    }
    return runChunk(0).then(function(){ return { updated: updated, sent: needFetch.length, total: list.length }; });
  }
  
  // Авто-оновлення при відкритті сторінки (не частіше 1 раз на 10 хв в межах сесії)
  var _lastNpAutoRefresh = 0;
  function maybeAutoRefreshNpTracking() {
    if (Date.now() - _lastNpAutoRefresh < 10*60*1000) return;
    _lastNpAutoRefresh = Date.now();
    trackNpOrders().then(function(r){
      if (r.updated > 0) {
        var ordersTab = document.getElementById('orders');
        if (ordersTab && ordersTab.classList.contains('active')) renderOrders();
      }
    }).catch(function(e){
      if (e.code === 'not-configured') {
        console.info('[lipo] NP tracking disabled (NP_API_KEY not set on server)');
      } else {
        console.warn('[lipo] NP tracking auto-refresh failed:', e.message);
      }
    });
  }
  
  // Ручне оновлення статусів
  function manualRefreshNpTracking() {
    var btn = document.getElementById('np-refresh-btn');
    var statusEl = document.getElementById('sync-status');
    if (!btn) return;
    btn.disabled = true;
    var orig = btn.innerHTML;
    btn.innerHTML = '⏳ Оновлення...';
    if (statusEl) statusEl.innerHTML = '<span class="text-muted">📍 Запитую статуси НП...</span>';
    trackNpOrders({force:true}).then(function(r){
      // Пере-синхронізація статусів для ВСІХ замовлень з наявним трекінгом
      // (не тільки щойно отриманих — охоплює старі закешовані результати)
      var db3 = getDB();
      var statusChanges = 0;
      (db3.orders||[]).forEach(function(o){
        if (o.tracking && syncOrderStatusFromTracking(o)) statusChanges++;
      });
      if (statusChanges > 0) saveDB(db3);
      var msg = '';
      if (r.updated > 0) {
        msg = '✅ Трекінг НП: оновлено <b>'+r.updated+'</b> з '+r.sent+' ТТН'+(statusChanges>0?' • статусів змінено: <b>'+statusChanges+'</b>':'');
        btn.innerHTML = '✓ Оновлено '+r.updated;
      } else if (r.sent > 0) {
        msg = '⚠ Трекінг НП: відправлено '+r.sent+' ТТН, але НП не повернула статусів. Перевірте що ТТН дійсні.';
        btn.innerHTML = '⚠ 0 результатів';
      } else {
        msg = 'ℹ Трекінг НП: не знайдено замовлень з ТТН для перевірки (всього замовлень: '+r.total+')';
        btn.innerHTML = '✓ Немає ТТН';
      }
      if (statusEl) statusEl.innerHTML = '<span style="font-size:13px;">'+msg+'</span>';
      setTimeout(function(){ btn.innerHTML = orig; btn.disabled = false; }, 3000);
      renderOrders();
    }).catch(function(e){
      var msg = '';
      if (e.code === 'not-configured') {
        msg = '⚠ <b>Трекінг НП не налаштовано</b>: NP_API_KEY не задано на сервері';
        btn.innerHTML = '⚠ Не налаштовано';
      } else {
        msg = '❌ <b>Помилка трекінгу НП</b>: ' + esc(e.message || 'невідома помилка');
        btn.innerHTML = '❌ Помилка';
      }
      if (statusEl) statusEl.innerHTML = '<span class="text-danger" style="font-size:13px;">'+msg+'</span>';
      setTimeout(function(){ btn.innerHTML = orig; btn.disabled = false; }, 4000);
    });
  }

  // Експорт
  window.statusToVisualNP = statusToVisualNP;
  window.syncOrderStatusFromTracking = syncOrderStatusFromTracking;
  window.ttnLooksLikeNP = ttnLooksLikeNP;
  window.trackNpOrders = trackNpOrders;
  window.maybeAutoRefreshNpTracking = maybeAutoRefreshNpTracking;
  window.manualRefreshNpTracking = manualRefreshNpTracking;
})();
