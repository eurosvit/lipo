// ============================================================
// LipoLand — Order Column Settings module
// ============================================================
// Конфігурація таблиці замовлень: які колонки показувати, в якому порядку,
// drag-and-drop reorder, owner-only колонки (профіт). calcOrderProfit
// тут бо ним користується тільки стовпець "Прибуток".

(function(){
  'use strict';

  // ==================== ORDER COLUMN SETTINGS ====================
  var _defaultOrdCols = [
    { id:'status', label:'Статус', visible:true },
    { id:'date', label:'Дата', visible:true },
    { id:'client', label:'Клієнт', visible:true },
    { id:'phone', label:'Телефон', visible:false },
    { id:'items', label:'Товари', visible:true },
    { id:'total', label:'Сума', visible:true },
    { id:'profit', label:'💰 Прибуток', visible:true, ownerOnly:true },
    { id:'payment', label:'Оплата', visible:false },
    { id:'delivery', label:'Доставка', visible:false },
    { id:'ttn', label:'ТТН', visible:false },
    { id:'channel', label:'Канал', visible:true },
    { id:'worker', label:'Майстер', visible:true },
    { id:'note', label:'📝', visible:false }
  ];
  
  // Прибуток по замовленню = виручка − (матеріали + друк + пакування + амортизація шаблону) − робота майстра − витрати на доставку.
  // Видно лише власнику. Майстер цю колонку не бачить.
  function calcOrderProfit(o, db) {
    if (!db) db = getDB();
    var revenue = Number(o.total) || 0;
    var shipping = Number(o.shippingCost) || 0;
    var materials = 0, work = 0, unknown = 0;
    (o.items || []).forEach(function(it) {
      var qty = Number(it.qty) || 0;
      if (!it.productId) { unknown += 1; return; }
      var p = (db.products || []).find(function(x) { return x.id === it.productId; });
      if (!p) { unknown += 1; return; }
      var c = calcCost(p, db.materials, db);
      materials += qty * ((c.materials || 0) + (c.print || 0) + (c.packaging || 0) + (c.template || 0));
      work += qty * (c.work || 0);
    });
    return { revenue: revenue, materials: materials, work: work, shipping: shipping, profit: revenue - materials - work - shipping, unknown: unknown };
  }
  
  function getOrdCols() {
    try {
      var saved = JSON.parse(localStorage.getItem('lipo_ord_cols'));
      if (saved && saved.length) {
        var savedIds = saved.map(function(c){return c.id;});
        _defaultOrdCols.forEach(function(d) {
          if (savedIds.indexOf(d.id)===-1) saved.push({id:d.id,label:d.label,visible:d.visible});
        });
        return saved.map(function(s) {
          var def = _defaultOrdCols.find(function(d){return d.id===s.id;});
          return def ? {id:s.id, label:def.label, visible:s.visible} : s;
        }).filter(function(s) {
          return _defaultOrdCols.some(function(d){return d.id===s.id;});
        });
      }
    } catch(e){}
    return _defaultOrdCols.map(function(c){return {id:c.id,label:c.label,visible:c.visible};});
  }
  
  function saveOrdCols(cols) { localStorage.setItem('lipo_ord_cols', JSON.stringify(cols)); }
  
  window._ordColsDraft = null;
  
  function toggleOrdColSettings() {
    var el = document.getElementById('ord-col-settings');
    el.style.display = el.style.display==='none' ? 'block' : 'none';
    if (el.style.display==='block') {
      window._ordColsDraft = getOrdCols();
      renderOrdColSettings();
    }
  }
  
  function renderOrdColSettings() {
    var cols = window._ordColsDraft || getOrdCols();
    if (isCurrentUserWorker()) {
      cols = cols.filter(function(c){
        var def = _defaultOrdCols.find(function(d){ return d.id === c.id; });
        return !(def && def.ownerOnly);
      });
    }
    var list = document.getElementById('ord-col-list');
    list.innerHTML = cols.map(function(c, i) {
      return '<div draggable="true" data-colid="'+c.id+'" data-idx="'+i+'" '+
          'ondragstart="ordColDragStart(event,\''+c.id+'\')" '+
          'ondragover="ordColDragOver(event,\''+c.id+'\')" '+
          'ondragleave="ordColDragLeave(event)" '+
          'ondrop="ordColDrop(event,\''+c.id+'\')" '+
          'ondragend="ordColDragEnd(event)" '+
          'style="display:flex;align-items:center;gap:8px;padding:6px 8px;background:#fff;border:1px solid var(--border);border-radius:8px;margin-bottom:4px;transition:background .15s,border-color .15s;">'+
        '<span title="Перетягніть для зміни порядку" style="cursor:grab;user-select:none;font-size:16px;color:#999;padding:0 4px;">≡</span>'+
        '<input type="checkbox" '+(c.visible?'checked':'')+' onchange="toggleOrdCol(\''+c.id+'\',this.checked)" style="width:16px;height:16px;accent-color:var(--primary);">'+
        '<span style="flex:1;font-size:13px;font-weight:500;">'+c.label+'</span>'+
        '<button onclick="moveOrdCol(\''+c.id+'\',-1)" title="Вгору" style="background:none;border:none;cursor:pointer;font-size:14px;padding:2px 4px;opacity:'+(i===0?'0.2':'0.7')+';" '+(i===0?'disabled':'')+'>▲</button>'+
        '<button onclick="moveOrdCol(\''+c.id+'\',1)" title="Вниз" style="background:none;border:none;cursor:pointer;font-size:14px;padding:2px 4px;opacity:'+(i===cols.length-1?'0.2':'0.7')+';" '+(i===cols.length-1?'disabled':'')+'>▼</button>'+
      '</div>';
    }).join('');
  }
  
  window._ordColDragId = null;
  
  function ordColDragStart(e, colId) {
    window._ordColDragId = colId;
    try { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', colId); } catch(err){}
    e.currentTarget.style.opacity = '0.4';
  }
  
  function ordColDragOver(e, colId) {
    if (window._ordColDragId == null || window._ordColDragId === colId) return;
    e.preventDefault();
    try { e.dataTransfer.dropEffect = 'move'; } catch(err){}
    e.currentTarget.style.borderColor = 'var(--primary)';
    e.currentTarget.style.background = '#F3E8FF';
  }
  
  function ordColDragLeave(e) {
    e.currentTarget.style.borderColor = 'var(--border)';
    e.currentTarget.style.background = '#fff';
  }
  
  function ordColDrop(e, targetId) {
    e.preventDefault();
    e.currentTarget.style.borderColor = 'var(--border)';
    e.currentTarget.style.background = '#fff';
    if (!window._ordColDragId || window._ordColDragId === targetId) { window._ordColDragId = null; return; }
    if (!window._ordColsDraft) window._ordColsDraft = getOrdCols();
    var fromIdx = window._ordColsDraft.findIndex(function(c){return c.id===window._ordColDragId;});
    var toIdx = window._ordColsDraft.findIndex(function(c){return c.id===targetId;});
    if (fromIdx === -1 || toIdx === -1) { window._ordColDragId = null; return; }
    var moved = window._ordColsDraft.splice(fromIdx, 1)[0];
    window._ordColsDraft.splice(toIdx, 0, moved);
    window._ordColDragId = null;
    renderOrdColSettings();
  }
  
  function ordColDragEnd(e) {
    e.currentTarget.style.opacity = '1';
    window._ordColDragId = null;
  }
  
  function toggleOrdCol(colId, visible) {
    if (!window._ordColsDraft) window._ordColsDraft = getOrdCols();
    var col = window._ordColsDraft.find(function(c){return c.id===colId;});
    if (col) col.visible = visible;
    renderOrdColSettings();
  }
  
  function moveOrdCol(colId, dir) {
    if (!window._ordColsDraft) window._ordColsDraft = getOrdCols();
    var idx = window._ordColsDraft.findIndex(function(c){return c.id===colId;});
    if (idx===-1) return;
    var newIdx = idx + dir;
    if (newIdx < 0 || newIdx >= window._ordColsDraft.length) return;
    var tmp = window._ordColsDraft[idx]; window._ordColsDraft[idx] = window._ordColsDraft[newIdx]; window._ordColsDraft[newIdx] = tmp;
    renderOrdColSettings();
  }
  
  function saveOrdColSettings() {
    if (window._ordColsDraft) saveOrdCols(window._ordColsDraft);
    window._ordColsDraft = null;
    document.getElementById('ord-col-settings').style.display = 'none';
    renderOrders();
  }
  
  function resetOrdCols() {
    localStorage.removeItem('lipo_ord_cols');
    window._ordColsDraft = getOrdCols();
    renderOrdColSettings();
  }

  // State vars на window (інакше inline ondragstart/etc не побачить)
  window.calcOrderProfit = calcOrderProfit;
  window.getOrdCols = getOrdCols;
  window.saveOrdCols = saveOrdCols;
  window.toggleOrdColSettings = toggleOrdColSettings;
  window.renderOrdColSettings = renderOrdColSettings;
  window.ordColDragStart = ordColDragStart;
  window.ordColDragOver = ordColDragOver;
  window.ordColDragLeave = ordColDragLeave;
  window.ordColDrop = ordColDrop;
  window.ordColDragEnd = ordColDragEnd;
  window.toggleOrdCol = toggleOrdCol;
  window.moveOrdCol = moveOrdCol;
  window.saveOrdColSettings = saveOrdColSettings;
  window.resetOrdCols = resetOrdCols;
})();
