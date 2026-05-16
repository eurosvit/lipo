// ============================================================
// LipoLand — Order Statuses module
// ============================================================
// Менеджер статусів замовлень з drag-and-drop, рейтингом кольорів,
// додаванням/видаленням/перейменуванням. Окрім UI містить
// getOrderStatuses з міграцією дефолтних системних статусів.

(function(){
  'use strict';

  // ==================== ORDER STATUSES ====================
  function getOrderStatuses() {
    var db = getDB();
    var statuses = db.orderStatuses || [{id:'new',label:'🆕 Новий',color:'#ffeaa7'},{id:'in_production',label:'🔧 На виробництві',color:'#81ecec'},{id:'shipped',label:'📦 Відправлено',color:'#74b9ff'},{id:'completed',label:'✔ Виконано',color:'#55efc4'},{id:'returned',label:'↩ Повернення',color:'#fab1a0'}];
    // Міграція: додати відсутні системні статуси
    var migrated = false;
    [{id:'shipped',label:'📦 Відправлено',color:'#74b9ff',before:'completed'},{id:'returned',label:'↩ Повернення',color:'#fab1a0',after:'completed'}].forEach(function(m){
      if (!statuses.some(function(s){return s.id===m.id})) {
        var refIdx = -1;
        if (statuses.findIndex) refIdx = statuses.findIndex(function(s){return s.id===(m.before||m.after)});
        var ins = {id:m.id,label:m.label,color:m.color};
        if (m.before && refIdx >= 0) statuses.splice(refIdx, 0, ins);
        else if (m.after && refIdx >= 0) statuses.splice(refIdx+1, 0, ins);
        else statuses.push(ins);
        migrated = true;
      }
    });
    if (migrated) { db.orderStatuses = statuses; saveDB(db); }
    return statuses;
  }
  
  function toggleStatusManager() {
    var el = document.getElementById('status-manager');
    el.style.display = el.style.display==='none' ? 'block' : 'none';
    if (el.style.display==='block') renderStatusManager();
  }
  
  function renderStatusManager() {
    var statuses = getOrderStatuses();
    var list = document.getElementById('status-list');
    if (!list) return;
    list.innerHTML = statuses.map(function(s, i) {
      return '<div draggable="true" data-statusid="'+s.id+'" '+
          'ondragstart="statusDragStart(event,\''+s.id+'\')" '+
          'ondragover="statusDragOver(event,\''+s.id+'\')" '+
          'ondragleave="statusDragLeave(event)" '+
          'ondrop="statusDrop(event,\''+s.id+'\')" '+
          'ondragend="statusDragEnd(event)" '+
          'style="display:flex;align-items:center;gap:8px;padding:6px 8px;background:#fff;border:1px solid var(--border);border-radius:8px;margin-bottom:4px;transition:background .15s,border-color .15s;">'+
        '<span title="Перетягни щоб змінити порядок" style="cursor:grab;user-select:none;font-size:16px;color:#999;padding:0 4px;">≡</span>'+
        '<input type="color" value="'+s.color+'" onchange="updateStatusColor(\''+s.id+'\',this.value)" style="width:28px;height:28px;padding:0;border:1px solid var(--border);border-radius:4px;cursor:pointer;">'+
        '<span style="flex:1;font-size:13px;font-weight:500;padding:4px 8px;background:'+s.color+';border-radius:6px;">'+esc(s.label)+'</span>'+
        '<button onclick="renameStatus(\''+s.id+'\')" style="background:none;border:none;cursor:pointer;font-size:13px;padding:2px 4px;" title="Перейменувати">✏️</button>'+
        '<button onclick="moveStatus(\''+s.id+'\',-1)" style="background:none;border:none;cursor:pointer;font-size:14px;padding:2px 4px;opacity:'+(i===0?'0.2':'0.7')+';" '+(i===0?'disabled':'')+'>▲</button>'+
        '<button onclick="moveStatus(\''+s.id+'\',1)" style="background:none;border:none;cursor:pointer;font-size:14px;padding:2px 4px;opacity:'+(i===statuses.length-1?'0.2':'0.7')+';" '+(i===statuses.length-1?'disabled':'')+'>▼</button>'+
        '<button onclick="deleteStatus(\''+s.id+'\')" style="background:none;border:none;cursor:pointer;font-size:13px;padding:2px 4px;color:#e74c3c;" title="Видалити">✕</button>'+
      '</div>';
    }).join('') || '<p class="text-muted" style="font-size:13px;">Додайте перший статус</p>';
  }
  
  // Drag&drop статусів — винесено в public/js/drag-drop.js
  
  
  function addOrderStatus() {
    var label = document.getElementById('new-status-label').value.trim();
    var color = document.getElementById('new-status-color').value;
    if (!label) return;
    var db = getDB();
    if (!db.orderStatuses) db.orderStatuses = getOrderStatuses();
    var id = label.toLowerCase().replace(/[^a-zа-яіїєґ0-9]/gi, '_').replace(/_+/g,'_');
    if (db.orderStatuses.some(function(s){return s.id===id})) id = id + '_' + Date.now();
    db.orderStatuses.push({ id:id, label:label, color:color });
    saveDB(db);
    document.getElementById('new-status-label').value = '';
    renderStatusManager();
    renderPage('orders');
  }
  
  function renameStatus(statusId) {
    var db = getDB();
    var statuses = db.orderStatuses || getOrderStatuses();
    var s = statuses.find(function(x){return x.id===statusId});
    if (!s) return;
    var newLabel = prompt('Нова назва статусу:', s.label);
    if (!newLabel || newLabel.trim() === '') return;
    s.label = newLabel.trim();
    db.orderStatuses = statuses;
    saveDB(db);
    renderStatusManager();
    renderPage('orders');
  }
  
  function updateStatusColor(statusId, color) {
    var db = getDB();
    var statuses = db.orderStatuses || getOrderStatuses();
    var s = statuses.find(function(x){return x.id===statusId});
    if (s) { s.color = color; db.orderStatuses = statuses; saveDB(db); renderStatusManager(); renderPage('orders'); }
  }
  
  function moveStatus(statusId, dir) {
    var db = getDB();
    var statuses = db.orderStatuses || getOrderStatuses();
    var idx = statuses.findIndex(function(x){return x.id===statusId});
    if (idx===-1) return;
    var newIdx = idx + dir;
    if (newIdx < 0 || newIdx >= statuses.length) return;
    var tmp = statuses[idx]; statuses[idx] = statuses[newIdx]; statuses[newIdx] = tmp;
    db.orderStatuses = statuses;
    saveDB(db);
    renderStatusManager();
    renderPage('orders');
  }
  
  function deleteStatus(statusId) {
    var db = getDB();
    var statuses = db.orderStatuses || getOrderStatuses();
    var s = statuses.find(function(x){return x.id===statusId});
    if (!s) return;
    var usedCount = db.orders.filter(function(o){return o.status===statusId}).length;
    var msg = 'Видалити статус "'+s.label+'"?';
    if (usedCount > 0) msg += '\n\n⚠️ '+usedCount+' замовлень з цим статусом будуть скинуті на перший статус.';
    if (!confirm(msg)) return;
    statuses = statuses.filter(function(x){return x.id!==statusId});
    var firstId = statuses.length ? statuses[0].id : 'new';
    db.orders.forEach(function(o){ if(o.status===statusId) o.status=firstId; });
    db.orderStatuses = statuses;
    saveDB(db);
    renderStatusManager();
    renderPage('orders');
  }

  window.getOrderStatuses = getOrderStatuses;
  window.toggleStatusManager = toggleStatusManager;
  window.renderStatusManager = renderStatusManager;
  window.addOrderStatus = addOrderStatus;
  window.renameStatus = renameStatus;
  window.updateStatusColor = updateStatusColor;
  window.moveStatus = moveStatus;
  window.deleteStatus = deleteStatus;
})();
