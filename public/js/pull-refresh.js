// ============================================================
// LipoLand — Pull-to-Refresh module (mobile)
// ============================================================
// Свайп згори вниз на 80+px → індикатор → reload data + render поточної сторінки.
// Працює тільки на мобільних (touch events).

(function(){
  'use strict';

  var startY = 0;
  var currentY = 0;
  var pulling = false;
  var threshold = 80;
  var indicator = null;
  var refreshing = false;

  function createIndicator() {
    if (indicator) return;
    indicator = document.createElement('div');
    indicator.id = 'pull-refresh-indicator';
    indicator.style.cssText = [
      'position:fixed',
      'top:0',
      'left:50%',
      'transform:translateX(-50%) translateY(-60px)',
      'background:linear-gradient(135deg,#7B1FA2,#4A148C)',
      'color:#fff',
      'padding:10px 22px',
      'border-radius:0 0 20px 20px',
      'font-size:13px',
      'font-weight:600',
      'z-index:99999',
      'transition:transform 0.2s ease-out',
      'box-shadow:0 4px 12px rgba(0,0,0,0.2)',
      'pointer-events:none',
      'white-space:nowrap'
    ].join(';');
    document.body.appendChild(indicator);
  }

  function showIndicator(text, offset) {
    if (!indicator) createIndicator();
    indicator.textContent = text;
    indicator.style.transform = 'translateX(-50%) translateY('+offset+'px)';
  }
  function hideIndicator() {
    if (indicator) indicator.style.transform = 'translateX(-50%) translateY(-60px)';
  }

  function doRefresh() {
    if (refreshing) return;
    refreshing = true;
    showIndicator('⏳ Оновлення...', 0);

    // 1) Reload data з сервера + render current page
    var p;
    try {
      p = fetch('/api/data').then(function(r){ return r.json(); }).then(function(srv){
        if (srv && (srv.materials || srv.products || srv.orders)) {
          window._dbCache = srv;
          try { localStorage.setItem(window.DB_KEY, JSON.stringify(srv)); } catch(e){}
        }
      }).catch(function(){});
    } catch(e) {
      p = Promise.resolve();
    }

    p.then(function(){
      var cur = localStorage.getItem('lipo_current_page') || 'dashboard';
      try { if (typeof window.renderPage === 'function') window.renderPage(cur); } catch(e){}
      // Trigger NP tracking refresh теж (якщо доступний)
      try { if (typeof window.maybeAutoRefreshNpTracking === 'function') window.maybeAutoRefreshNpTracking(); } catch(e){}
      showIndicator('✓ Оновлено', 0);
      setTimeout(function(){
        hideIndicator();
        refreshing = false;
      }, 800);
    });
  }

  function onTouchStart(e) {
    if (refreshing) return;
    // Only top of page
    if ((window.scrollY || document.documentElement.scrollTop) > 0) return;
    startY = e.touches[0].clientY;
    currentY = startY;
    pulling = true;
  }

  function onTouchMove(e) {
    if (!pulling || refreshing) return;
    currentY = e.touches[0].clientY;
    var distance = currentY - startY;
    if (distance > 0 && (window.scrollY || document.documentElement.scrollTop) === 0) {
      // Apply rubber-band effect
      var pull = Math.min(distance * 0.5, 100);
      if (pull > 20) {
        var text = pull >= threshold ? '↓ Відпустіть для оновлення' : '↓ Тягніть щоб оновити';
        showIndicator(text, Math.min(pull - 20, 30));
      }
    }
  }

  function onTouchEnd(e) {
    if (!pulling || refreshing) return;
    pulling = false;
    var distance = (currentY - startY) * 0.5;
    if (distance >= threshold) {
      doRefresh();
    } else {
      hideIndicator();
    }
    startY = 0;
    currentY = 0;
  }

  // Only attach on touch-capable devices to avoid trackpad gestures on desktop Safari
  if ('ontouchstart' in window || (navigator.maxTouchPoints && navigator.maxTouchPoints > 0)) {
    document.addEventListener('touchstart', onTouchStart, { passive: true });
    document.addEventListener('touchmove', onTouchMove, { passive: true });
    document.addEventListener('touchend', onTouchEnd, { passive: true });
  }
})();
