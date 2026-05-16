// ============================================================
// LipoLand — Order pagination + sort module
// ============================================================
// Стейт window._ordPage/window._ordSortCol/window._ordSortDir на window — використовується
// renderOrders який лишається в index.html.

(function(){
  'use strict';

  // ==================== PAGINATION ====================
  window._ordPage = 1;
  window._ordSortCol = "date";
  window._ordSortDir = "desc";
  function toggleOrdSort(col) {
    if (window._ordSortCol === col) window._ordSortDir = window._ordSortDir === 'desc' ? 'asc' : 'desc';
    else { window._ordSortCol = col; window._ordSortDir = col === 'total' || col === 'date' ? 'desc' : 'asc'; }
    renderOrders();
  }
  
  function getOrdPageSize() {
    var v = localStorage.getItem('lipo_ord_page_size');
    if (v === 'all') return 'all';
    var n = parseInt(v, 10);
    return (n && n > 0) ? n : 25;
  }
  function setOrdPageSize(v) {
    localStorage.setItem('lipo_ord_page_size', v);
    window._ordPage = 1;
    renderOrders();
  }
  function setOrdPage(p) {
    window._ordPage = Math.max(1, p);
    renderOrders();
    try {
      var el = document.getElementById('orders');
      if (el) el.scrollIntoView({behavior:'smooth', block:'start'});
    } catch(e){}
  }
  
  function setOrdDatePreset(preset) {
    var today = new Date();
    var y = today.getFullYear(), m = today.getMonth();
    var fromEl = document.getElementById('ord-date-from');
    var toEl = document.getElementById('ord-date-to');
    function fmtDate(d){ return d.toISOString().slice(0,10); }
    if (preset === 'thisMonth') {
      fromEl.value = fmtDate(new Date(y, m, 1));
      toEl.value = fmtDate(new Date(y, m+1, 0));
    } else if (preset === 'lastMonth') {
      fromEl.value = fmtDate(new Date(y, m-1, 1));
      toEl.value = fmtDate(new Date(y, m, 0));
    } else if (preset === 'today') {
      var s = fmtDate(today);
      fromEl.value = s; toEl.value = s;
    } else if (preset === 'clear') {
      fromEl.value = ''; toEl.value = '';
    }
    renderOrders();
  }
  function renderOrdPagination(total, pageSize, pageCount) {
    var wrap = document.getElementById('orders-pagination');
    var controls = document.getElementById('ord-page-controls');
    var info = document.getElementById('ord-page-info');
    var sel = document.getElementById('ord-page-size');
    if (!wrap || !controls || !sel) return;
  
    // Sync select value
    sel.value = String(pageSize);
  
    // Hide entire bar if <= 10 items AND default page size (no choice needed)
    if (total <= 10 && pageSize !== 'all') {
      wrap.style.display = 'none';
      return;
    }
    wrap.style.display = 'flex';
  
    if (pageSize === 'all' || pageCount <= 1) {
      controls.innerHTML = '';
      info.textContent = total + ' замовлень';
      return;
    }
  
    // Build page buttons: « 1 … (cur-1) cur (cur+1) … N »
    var btns = [];
    function pageBtn(p, label, opts) {
      opts = opts || {};
      var disabled = opts.disabled ? 'disabled' : '';
      var active = opts.active;
      var style = 'padding:4px 10px;border-radius:6px;font-size:13px;border:1px solid '+(active?'var(--primary)':'var(--border)')+';background:'+(active?'var(--primary)':'#fff')+';color:'+(active?'#fff':'var(--text)')+';cursor:'+(opts.disabled?'not-allowed':'pointer')+';min-width:32px;opacity:'+(opts.disabled?'0.4':'1')+';font-weight:'+(active?'600':'400')+';';
      return '<button '+disabled+' onclick="setOrdPage('+p+')" style="'+style+'">'+label+'</button>';
    }
    function ellipsis(){ return '<span style="padding:0 4px;color:var(--text-light);">…</span>'; }
  
    btns.push(pageBtn(window._ordPage-1, '‹', {disabled: window._ordPage<=1}));
  
    // Always show page 1
    btns.push(pageBtn(1, '1', {active: window._ordPage===1}));
    if (window._ordPage > 3) btns.push(ellipsis());
    for (var p = Math.max(2, window._ordPage-1); p <= Math.min(pageCount-1, window._ordPage+1); p++) {
      btns.push(pageBtn(p, String(p), {active: window._ordPage===p}));
    }
    if (window._ordPage < pageCount-2) btns.push(ellipsis());
    if (pageCount > 1) btns.push(pageBtn(pageCount, String(pageCount), {active: window._ordPage===pageCount}));
  
    btns.push(pageBtn(window._ordPage+1, '›', {disabled: window._ordPage>=pageCount}));
  
    controls.innerHTML = btns.join('');
    info.textContent = 'Стор. ' + window._ordPage + ' з ' + pageCount;
  }

  // window._ordPage/window._ordSortCol/window._ordSortDir мають бути на window — інакше renderOrders їх не побачить
  window.toggleOrdSort = toggleOrdSort;
  window.getOrdPageSize = getOrdPageSize;
  window.setOrdPageSize = setOrdPageSize;
  window.setOrdPage = setOrdPage;
  window.setOrdDatePreset = setOrdDatePreset;
  window.renderOrdPagination = renderOrdPagination;
})();
