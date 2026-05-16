// ============================================================
// LipoLand — Drag&Drop module (статуси + категорії)
// ============================================================
// Reusable HTML5 native drag&drop для перестановки статусів замовлень
// і категорій товарів. Викликається з inline ondragstart/over/leave/drop/end
// в результатах renderStatusManager / renderCatManager.

(function(){
  'use strict';

  // ---------- Статуси замовлень ----------
  var _statusDragId = null;

  function statusDragStart(e, id) {
    _statusDragId = id;
    e.dataTransfer.effectAllowed = 'move';
    e.target.style.opacity = '0.5';
  }
  function statusDragOver(e, id) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (_statusDragId && _statusDragId !== id) e.currentTarget.style.background = '#F3E5F5';
  }
  function statusDragLeave(e) { e.currentTarget.style.background = ''; }
  function statusDrop(e, targetId) {
    e.preventDefault();
    e.currentTarget.style.background = '';
    if (!_statusDragId || _statusDragId === targetId) return;
    var db = getDB();
    var statuses = db.orderStatuses || getOrderStatuses();
    var fromIdx = statuses.findIndex(function(s){return s.id === _statusDragId;});
    var toIdx = statuses.findIndex(function(s){return s.id === targetId;});
    if (fromIdx === -1 || toIdx === -1) return;
    var moved = statuses.splice(fromIdx, 1)[0];
    statuses.splice(toIdx, 0, moved);
    db.orderStatuses = statuses;
    saveDB(db);
    renderStatusManager();
    renderPage('orders');
  }
  function statusDragEnd(e) {
    _statusDragId = null;
    e.target.style.opacity = '';
    document.querySelectorAll('[data-statusid]').forEach(function(el){ el.style.background = ''; });
  }

  // ---------- Категорії товарів (db.categoryOrder) ----------
  var _catDragName = null;

  function catDragStart(e, name) {
    _catDragName = name;
    e.dataTransfer.effectAllowed = 'move';
    e.target.style.opacity = '0.5';
  }
  function catDragOver(e, name) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (_catDragName && _catDragName !== name) e.currentTarget.style.background = '#F3E5F5';
  }
  function catDragLeave(e) { e.currentTarget.style.background = ''; }
  function catDrop(e, targetName) {
    e.preventDefault();
    e.currentTarget.style.background = '';
    if (!_catDragName || _catDragName === targetName) return;
    var db = getDB();
    var order = (db.categoryOrder && db.categoryOrder.length) ? db.categoryOrder.slice() : getCategories(db);
    var fromIdx = order.indexOf(_catDragName);
    var toIdx = order.indexOf(targetName);
    if (fromIdx === -1) {
      order.push(_catDragName);
      fromIdx = order.length - 1;
    }
    if (toIdx === -1) { order.push(targetName); toIdx = order.length - 1; }
    var moved = order.splice(fromIdx, 1)[0];
    if (fromIdx < toIdx) toIdx--;
    order.splice(toIdx, 0, moved);
    db.categoryOrder = order;
    saveDB(db);
    renderProducts();
  }
  function catDragEnd(e) {
    _catDragName = null;
    e.target.style.opacity = '';
    document.querySelectorAll('[data-cat]').forEach(function(el){ el.style.background = ''; });
  }

  // Export
  window.statusDragStart = statusDragStart;
  window.statusDragOver = statusDragOver;
  window.statusDragLeave = statusDragLeave;
  window.statusDrop = statusDrop;
  window.statusDragEnd = statusDragEnd;
  window.catDragStart = catDragStart;
  window.catDragOver = catDragOver;
  window.catDragLeave = catDragLeave;
  window.catDrop = catDrop;
  window.catDragEnd = catDragEnd;
})();
