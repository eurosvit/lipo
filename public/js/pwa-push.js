// ============================================================
// LipoLand — PWA registration + Push notifications module
// ============================================================
// Винесено з index.html для організації коду. Всі функції — глобальні
// (через window.X = X) щоб inline-обробники типу onclick="pwaInstall()"
// продовжували працювати без змін.

(function(){
  'use strict';

  // ---------- PWA: Service Worker registration + install prompt ----------
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function(){
      navigator.serviceWorker.register('/service-worker.js', { scope: '/' })
        .then(function(reg){
          // Перевіряємо оновлення кожні 30 хв
          setInterval(function(){ reg.update().catch(function(){}); }, 30 * 60 * 1000);
          reg.addEventListener('updatefound', function(){
            var nw = reg.installing;
            if (!nw) return;
            nw.addEventListener('statechange', function(){
              if (nw.state === 'installed' && navigator.serviceWorker.controller) {
                try { nw.postMessage('SKIP_WAITING'); } catch(_) {}
              }
            });
          });
        })
        .catch(function(e){ console.warn('SW register failed:', e); });

      var refreshing = false;
      navigator.serviceWorker.addEventListener('controllerchange', function(){
        if (refreshing) return;
        refreshing = true;
        window.location.reload();
      });
    });
  }

  // Відкладений install prompt (Chrome/Edge/Android)
  window._deferredInstallPrompt = null;
  window.addEventListener('beforeinstallprompt', function(e){
    e.preventDefault();
    window._deferredInstallPrompt = e;
    var btn = document.getElementById('pwa-install-btn');
    if (btn) btn.style.display = 'inline-flex';
  });
  window.addEventListener('appinstalled', function(){
    window._deferredInstallPrompt = null;
    var btn = document.getElementById('pwa-install-btn');
    if (btn) btn.style.display = 'none';
    try { localStorage.setItem('lipo_pwa_installed', '1'); } catch(_) {}
  });

  function pwaInstall() {
    var p = window._deferredInstallPrompt;
    if (!p) {
      var isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
      if (isIOS) {
        alert('На iPhone: натисни «Поділитись» (квадрат зі стрілкою) → «На початковий екран».');
      } else {
        alert('Встановлення недоступне у цьому браузері. Спробуй Chrome/Edge на Android чи десктопі.');
      }
      return;
    }
    p.prompt();
    p.userChoice.then(function(){ window._deferredInstallPrompt = null; });
  }

  window._isStandalonePWA = (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || window.navigator.standalone === true;

  // ---------- Push notifications ----------
  function urlBase64ToUint8Array(base64String) {
    var padding = '='.repeat((4 - base64String.length % 4) % 4);
    var base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    var raw = atob(base64);
    var arr = new Uint8Array(raw.length);
    for (var i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
    return arr;
  }

  async function getPushSubscription() {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return null;
    try {
      var reg = await navigator.serviceWorker.ready;
      return await reg.pushManager.getSubscription();
    } catch (e) { return null; }
  }

  async function pushEnable() {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      alert('Цей браузер не підтримує push-сповіщення. Спробуй Chrome/Edge на Android чи десктоп.');
      return;
    }
    if (Notification.permission === 'denied') {
      alert('Сповіщення заблоковані в браузері. Зайди в налаштування сайту → дозволь сповіщення.');
      return;
    }
    try {
      var perm = await Notification.requestPermission();
      if (perm !== 'granted') { alert('Без дозволу сповіщень підписка неможлива.'); return; }
      var reg = await navigator.serviceWorker.ready;
      var keyResp = await fetch('/api/push/vapid-key');
      if (!keyResp.ok) { alert('Push на сервері не налаштовано.'); return; }
      var keyData = await keyResp.json();
      if (!keyData.publicKey) { alert('VAPID-ключ недоступний.'); return; }
      var sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(keyData.publicKey)
      });
      var saveResp = await fetch('/api/push/subscribe', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ subscription: sub.toJSON(), userAgent: navigator.userAgent })
      });
      if (!saveResp.ok) { alert('Не вдалось зберегти підписку. Спробуй ще раз.'); return; }
      refreshPushUI();
      alert('✅ Push увімкнено! Натисни «Тест-сповіщення» щоб перевірити.');
    } catch (e) {
      console.error('Push enable failed:', e);
      alert('Помилка: ' + (e.message || e));
    }
  }

  async function pushDisable() {
    if (!confirm('Вимкнути push-сповіщення на цьому пристрої?')) return;
    try {
      var sub = await getPushSubscription();
      if (sub) {
        await sub.unsubscribe();
        await fetch('/api/push/unsubscribe', {
          method: 'POST', headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({ endpoint: sub.endpoint })
        });
      }
      refreshPushUI();
      alert('🔕 Push вимкнено на цьому пристрої.');
    } catch (e) {
      alert('Помилка: ' + (e.message || e));
    }
  }

  async function pushTest() {
    try {
      var r = await fetch('/api/push/test', { method: 'POST' });
      var data = await r.json();
      if (data.sent > 0) {
        console.log('Push test sent to', data.sent, 'devices');
      } else {
        alert('Не вдалось надіслати — можливо підписка експайрилась. Спробуй вимкнути і знов увімкнути push.');
      }
    } catch (e) {
      alert('Помилка: ' + (e.message || e));
    }
  }

  async function refreshPushUI() {
    var statusBox = document.getElementById('push-status-box');
    var enableBtn = document.getElementById('push-enable-btn');
    var testBtn = document.getElementById('push-test-btn');
    var disableBtn = document.getElementById('push-disable-btn');
    if (!statusBox) return;

    if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
      statusBox.innerHTML = '⚠ Браузер не підтримує push-сповіщення';
      statusBox.style.color = 'var(--warning)';
      if (enableBtn) enableBtn.style.display = 'none';
      if (testBtn) testBtn.style.display = 'none';
      if (disableBtn) disableBtn.style.display = 'none';
      return;
    }

    var perm = Notification.permission;
    var sub = await getPushSubscription();

    if (sub) {
      statusBox.innerHTML = '✅ Push увімкнено на цьому пристрої';
      statusBox.style.color = 'var(--success)';
      if (enableBtn) enableBtn.style.display = 'none';
      if (testBtn) testBtn.style.display = 'inline-flex';
      if (disableBtn) disableBtn.style.display = 'inline-flex';
    } else if (perm === 'denied') {
      statusBox.innerHTML = '🚫 Сповіщення заблоковані в браузері. Дозволь у налаштуваннях сайту.';
      statusBox.style.color = 'var(--danger)';
      if (enableBtn) enableBtn.style.display = 'none';
      if (testBtn) testBtn.style.display = 'none';
      if (disableBtn) disableBtn.style.display = 'none';
    } else {
      statusBox.innerHTML = '⏸ Push не увімкнено';
      statusBox.style.color = 'var(--text-light)';
      if (enableBtn) enableBtn.style.display = 'inline-flex';
      if (testBtn) testBtn.style.display = 'none';
      if (disableBtn) disableBtn.style.display = 'none';
    }
  }

  // Expose globally — потрібно для inline-обробників onclick="pwaInstall()" і т.п.
  window.pwaInstall = pwaInstall;
  window.pushEnable = pushEnable;
  window.pushDisable = pushDisable;
  window.pushTest = pushTest;
  window.refreshPushUI = refreshPushUI;
})();
