// ============================================================
// LipoLand — Audit Log module
// ============================================================
// Журнал змін: хто/коли/що зробив. Auto-trim до 2000 записів.
// logAudit викликається з основного script, тому має бути global.
// Усі функції експортуються через window.X для inline-сумісності.

(function(){
  'use strict';

  // ВАЖЛИВО: logAudit мутує db, але НЕ викликає saveDB —
  // викликай ПЕРЕД saveDB(db) у виклику-батьку.
  function logAudit(db, entity, entityId, action, details) {
    if (!db) return;
    if (!db.auditLog) db.auditLog = [];
    var userName = (window._currentUser && (window._currentUser.linkedWorkerName || window._currentUser.name)) || 'Невідомо';
    var userEmail = (window._currentUser && window._currentUser.email) || '';
    var isWorker = !!(window._currentUser && window._currentUser.isWorker);
    db.auditLog.push({
      id: uid(),
      ts: new Date().toISOString(),
      user: userName,
      userEmail: userEmail,
      role: isWorker ? 'worker' : 'owner',
      entity: entity,
      entityId: entityId || '',
      action: action,
      details: details || {}
    });
    if (db.auditLog.length > 2000) {
      db.auditLog = db.auditLog.slice(-2000);
    }
  }

  var _auditActionLabels = {
    create: '➕ Створено', edit: '✏️ Редаговано', delete: '🗑 Видалено',
    status_change: '🔄 Статус', ship: '📦 Відправлено', unship: '↩ Скасовано відправку',
    return: '↩ Повернення', pay: '💸 Виплата', complete: '✅ Здано',
    start: '▶ Запущено', transfer: '🔄 Передано', adjust: '⚖️ Корекція',
    price_change: '💰 Ціна'
  };
  var _auditEntityLabels = {
    order: '📋 Замовлення', product: '📦 Товар', material: '🧵 Матеріал',
    production: '🔧 Виробництво', salary: '💰 ЗП', workerStock: '👷 Склад майстра',
    client: '👥 Клієнт'
  };

  function renderAuditLog() {
    var db = getDB();
    var isW = window._currentUser && window._currentUser.isWorker;
    var log = (db.auditLog || []).slice().reverse();
    if (isW) {
      var myEmail = (window._currentUser.email||'').toLowerCase();
      log = log.filter(function(r){ return (r.userEmail||'').toLowerCase() === myEmail; });
    }

    var entityFilter = document.getElementById('audit-entity-filter');
    var actionFilter = document.getElementById('audit-action-filter');
    var userFilter = document.getElementById('audit-user-filter');
    var dateFromEl = document.getElementById('audit-date-from');
    var dateToEl = document.getElementById('audit-date-to');

    if (!isW && userFilter) {
      var users = {};
      log.forEach(function(r){ if (r.user) users[r.user] = true; });
      var curU = userFilter.value;
      userFilter.innerHTML = '<option value="">Усі користувачі</option>' +
        Object.keys(users).sort().map(function(u){return '<option value="'+esc(u)+'" '+(u===curU?'selected':'')+'>'+esc(u)+'</option>';}).join('');
    }

    var eF = entityFilter ? entityFilter.value : '';
    var aF = actionFilter ? actionFilter.value : '';
    var uF = !isW && userFilter ? userFilter.value : '';
    var dF = dateFromEl ? dateFromEl.value : '';
    var dT = dateToEl ? dateToEl.value : '';
    var filtered = log.filter(function(r){
      if (eF && r.entity !== eF) return false;
      if (aF && r.action !== aF) return false;
      if (uF && r.user !== uF) return false;
      var rDay = (r.ts||'').slice(0,10);
      if (dF && rDay < dF) return false;
      if (dT && rDay > dT) return false;
      return true;
    });

    var today = new Date().toISOString().slice(0,10);
    var todayCount = log.filter(function(r){return (r.ts||'').startsWith(today);}).length;
    var weekAgo = new Date(Date.now() - 7*86400000).toISOString().slice(0,10);
    var weekCount = log.filter(function(r){return (r.ts||'').slice(0,10) >= weekAgo;}).length;
    var byUser = {};
    log.forEach(function(r){ byUser[r.user] = (byUser[r.user]||0)+1; });
    var topUsers = Object.keys(byUser).sort(function(a,b){return byUser[b]-byUser[a];}).slice(0,3);

    document.getElementById('audit-cards').innerHTML =
      '<div class="card"><div class="card-label">Всього записів</div><div class="card-value">'+log.length+'</div><div class="card-sub">'+(log.length>=2000?'⚠ auto-trim на 2000':'ліміт: 2000')+'</div></div>'+
      '<div class="card"><div class="card-label">Сьогодні</div><div class="card-value">'+todayCount+'</div></div>'+
      '<div class="card"><div class="card-label">За 7 днів</div><div class="card-value">'+weekCount+'</div></div>'+
      (!isW && topUsers.length ? '<div class="card"><div class="card-label">Топ-користувачі</div><div class="card-value" style="font-size:14px;line-height:1.6;">'+topUsers.map(function(u){return esc(u)+' <span style="color:var(--text-light);font-size:12px;">('+byUser[u]+')</span>';}).join('<br>')+'</div></div>' : '');

    document.getElementById('audit-table').innerHTML = filtered.slice(0, 500).map(function(r){
      var ts = new Date(r.ts);
      var dateStr = isNaN(ts.getTime()) ? r.ts : ts.toLocaleString('uk-UA',{year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'});
      var actLbl = _auditActionLabels[r.action] || r.action;
      var entLbl = _auditEntityLabels[r.entity] || r.entity;
      var roleBadge = r.role === 'worker' ? '<span class="badge" style="background:#E3F2FD;color:#1565C0;font-size:9px;">👷 майстер</span>' : '<span class="badge" style="background:#F3E5F5;color:#4A148C;font-size:9px;">👑 власник</span>';
      var detailsStr = '';
      if (r.details && typeof r.details === 'object') {
        var parts = [];
        Object.keys(r.details).forEach(function(k){
          var v = r.details[k];
          if (v === null || v === undefined || v === '') return;
          if (typeof v === 'object') v = JSON.stringify(v);
          parts.push('<span style="color:var(--text-light);">'+esc(k)+':</span> '+esc(String(v).slice(0,80)));
        });
        detailsStr = parts.join(' &middot; ');
      }
      return '<tr>'+
        '<td data-label="Час" style="white-space:nowrap;font-size:12px;color:var(--text-light);">'+esc(dateStr)+'</td>'+
        '<td data-label="Користувач" style="font-size:12px;"><strong>'+esc(r.user||'?')+'</strong><br>'+roleBadge+'</td>'+
        '<td data-label="Що" style="font-size:12px;">'+esc(entLbl)+(r.entityId?' <code style="font-size:10px;color:var(--text-light);">'+esc(String(r.entityId).slice(-8))+'</code>':'')+'</td>'+
        '<td data-label="Дія" style="font-size:12px;font-weight:600;">'+esc(actLbl)+'</td>'+
        '<td data-label="Деталі" style="font-size:11px;line-height:1.4;">'+detailsStr+'</td>'+
      '</tr>';
    }).join('') || '<tr><td colspan="5" class="text-muted" style="text-align:center;padding:40px;">'+(log.length?'Немає записів за поточним фільтром':'Журнал порожній — почни робити зміни')+'</td></tr>';

    if (filtered.length > 500) {
      document.getElementById('audit-table').innerHTML += '<tr><td colspan="5" class="text-muted" style="text-align:center;padding:10px;font-size:11px;">Показано 500 з '+filtered.length+'. Звузь фільтр щоб побачити старіші.</td></tr>';
    }
  }

  function exportAuditLog() {
    var db = getDB();
    var log = (db.auditLog || []).slice();
    if (!log.length) return alert('Журнал порожній');
    var headers = ['Час','Користувач','Email','Роль','Що','EntityId','Дія','Деталі'];
    var rows = log.map(function(r){
      var detailsStr = r.details ? JSON.stringify(r.details).replace(/"/g,'""') : '';
      return [r.ts, r.user, r.userEmail, r.role, r.entity, r.entityId, r.action, detailsStr]
        .map(function(v){ return '"'+String(v||'').replace(/"/g,'""')+'"'; })
        .join(',');
    });
    var csv = '﻿' + headers.join(',') + '\n' + rows.join('\n');
    var blob = new Blob([csv], {type:'text/csv;charset=utf-8;'});
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = 'audit-log-' + new Date().toISOString().slice(0,10) + '.csv';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function clearAuditLog() {
    if (!confirm('Очистити весь журнал змін? Дію не можна скасувати. Можеш спершу експортувати CSV.')) return;
    var db = getDB();
    db.auditLog = [];
    saveDB(db);
    renderAuditLog();
  }

  // Експортуємо для inline-обробників і викликів з основного script
  window.logAudit = logAudit;
  window.renderAuditLog = renderAuditLog;
  window.exportAuditLog = exportAuditLog;
  window.clearAuditLog = clearAuditLog;
})();
