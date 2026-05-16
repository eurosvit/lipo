// ============================================================
// LipoLand — Account + Notifications + Telegram module
// ============================================================
// window._currentUser, window._workerAliasMap, window._linkedWorkerNames — стейт на window
// (читається з багатьох модулів через window.window._currentUser).
// loadAccount — викликається на init у DOMContentLoaded.

(function(){
  'use strict';

  // ==================== ACCOUNT & NOTIFICATIONS ====================
  window._currentUser = null;
  window._linkedWorkerNames = []; // names of workers connected via CRM
  
  // Returns the current worker's known aliases for filtering (or []).
  // Falls back to localStorage if window._currentUser hasn't loaded yet — prevents
  // a brief "shows everything" flash when a worker navigates fast.
  function getCurrentWorkerAliases() {
    if (window._currentUser && window._currentUser.isWorker) {
      if (window._currentUser.workerAliases && window._currentUser.workerAliases.length) return window._currentUser.workerAliases;
      var one = window._currentUser.linkedWorkerName || window._currentUser.name || '';
      return one ? [one] : [];
    }
    try {
      var wr = JSON.parse(localStorage.getItem('lipo_worker_role') || 'null');
      if (wr && wr.isWorker) {
        if (wr.workerAliases && wr.workerAliases.length) return wr.workerAliases;
        return wr.linkedWorkerName ? [wr.linkedWorkerName] : [];
      }
    } catch(e) {}
    return [];
  }
  function isCurrentUserWorker() {
    if (window._currentUser) return !!window._currentUser.isWorker;
    try {
      var wr = JSON.parse(localStorage.getItem('lipo_worker_role') || 'null');
      return !!(wr && wr.isWorker);
    } catch(e) { return false; }
  }
  window._workerAliasMap = {};    // realName -> owner_alias (for display only, owner view)
  
  // Returns display label for a worker name (alias if set by owner, else original name).
  // Used only in owner's view — workers never have alias data in their session.
  function wLabel(name) {
    if (!name) return '';
    return window._workerAliasMap[name] || name;
  }
  
  function loadAccount() {
    fetch('/api/auth/me').then(function(r){ return r.json(); }).then(function(u){
      if (!u || u.error) return;
      window._currentUser = u;
      var initial = (u.name||u.email||'?').charAt(0).toUpperCase();
      document.getElementById('account-avatar').textContent = initial;
      document.getElementById('account-name-short').textContent = (u.name||'').split(' ')[0] || 'Акаунт';
      document.getElementById('acc-name').textContent = u.name || '—';
      document.getElementById('acc-email').textContent = u.email || '—';
      document.getElementById('acc-role').textContent = u.role === 'admin' ? 'Адмін' : 'Користувач';
  
      var statusEl = document.getElementById('acc-status');
      var untilEl = document.getElementById('acc-until');
      if (u.role === 'admin') {
        statusEl.textContent = 'Активний';
        statusEl.className = 'value active';
        untilEl.textContent = 'Безстроково';
      } else if (u.subscriptionEndsAt && new Date(u.subscriptionEndsAt) > new Date()) {
        statusEl.textContent = 'Підписка';
        statusEl.className = 'value active';
        untilEl.textContent = new Date(u.subscriptionEndsAt).toLocaleDateString('uk-UA');
      } else if (u.trialEndsAt && new Date(u.trialEndsAt) > new Date()) {
        var daysLeft = Math.ceil((new Date(u.trialEndsAt) - new Date()) / (1000*60*60*24));
        statusEl.textContent = 'Пробний період';
        statusEl.className = 'value active';
        untilEl.textContent = daysLeft + ' дн. залишилось';
      } else {
        statusEl.textContent = 'Закінчився';
        statusEl.className = 'value expired';
        untilEl.textContent = '—';
      }
  
      // Admin nav visibility
      var adminNav = document.getElementById('nav-admin');
      if (adminNav) adminNav.style.display = u.role === 'admin' ? '' : 'none';
      var mobileAdminNav = document.getElementById('mobile-nav-admin');
      if (mobileAdminNav) mobileAdminNav.style.display = u.role === 'admin' ? '' : 'none';
  
      // Worker role info — save to localStorage for instant nav on reload
      if (u.isWorker) {
        localStorage.setItem('lipo_worker_role', JSON.stringify({
          isWorker: true,
          permissions: u.workerPermissions || {},
          linkedWorkerName: u.linkedWorkerName || '',
          workerAliases: u.workerAliases || [],
          ownerName: u.ownerName || ''
        }));
        // Re-render data pages that depend on worker filtering (they may have
        // rendered before window._currentUser was set, showing unfiltered data).
        try {
          var _cp = localStorage.getItem('lipo_current_page');
          if (_cp === 'orders' && typeof renderOrders === 'function') renderOrders();
          if (_cp === 'production' && typeof renderProduction === 'function') renderProduction();
          if (_cp === 'salary' && typeof renderSalary === 'function') renderSalary();
          if (_cp === 'worker-stock' && typeof renderWorkerStock === 'function') renderWorkerStock();
        } catch(e) {}
        document.getElementById('acc-role').textContent = 'Майстер у ' + (u.ownerName || '—');
        // Hide payment button and subscription info for workers
        var payBtn = document.getElementById('acc-pay-btn');
        if (payBtn) payBtn.style.display = 'none';
        var statusEl = document.getElementById('acc-status');
        if (statusEl) statusEl.textContent = u.ownerHasAccess !== false ? 'Активний' : 'Обмежено';
        var untilEl = document.getElementById('acc-until');
        if (untilEl) untilEl.textContent = 'Доступ через ' + (u.ownerName || '—');
      } else {
        localStorage.removeItem('lipo_worker_role');
      }
      // Apply feature toggles first, then worker permissions (permissions win for workers)
      applyFeatures();
      if (u && u.isWorker) applyWorkerPermissions();
      // Check for announcements after short delay (let UI settle)
      setTimeout(checkAnnouncement, 2000);
    }).catch(function(){});
  }
  
  function toggleAccountPanel() {
    var panel = document.getElementById('account-panel');
    panel.classList.toggle('show');
    document.getElementById('notif-panel').classList.remove('show');
  }
  
  function toggleNotifPanel() {
    var panel = document.getElementById('notif-panel');
    panel.classList.toggle('show');
    document.getElementById('account-panel').classList.remove('show');
  }
  
  // Close panels on click outside
  document.addEventListener('click', function(e) {
    if (!e.target.closest('.nav-right')) {
      document.getElementById('account-panel').classList.remove('show');
      document.getElementById('notif-panel').classList.remove('show');
    }
  });
  
  window._readNotifIds = JSON.parse(localStorage.getItem('lipo_read_notifs') || '[]');
  
  function updateNotifications() {
    var db = getDB();
    var notifs = [];
    var today = new Date();
    today.setHours(0,0,0,0);
  
    // Low stock materials (totals across own stock + workers)
    (db.materials||[]).forEach(function(m) {
      var atW = matAtWorkers(db, m.id);
      var total = (m.qty||0) + atW;
      var atWNote = atW>0 ? ' (у майстрів: '+fmt(atW)+')' : '';
      if (total <= 0) {
        notifs.push({ id:'mat_'+m.id+'_0', type:'danger', icon:'📦', text:'<b>'+esc(m.name)+'</b> — закінчився (0 в наявності)' });
      } else if (m.min && total <= m.min) {
        notifs.push({ id:'mat_'+m.id+'_low', type:'warning', icon:'📦', text:'<b>'+esc(m.name)+'</b> — залишок '+fmt(total)+' '+esc(m.unit)+atWNote+' (мін. '+fmt(m.min)+')' });
      }
    });
  
    // Low stock products
    (db.products||[]).forEach(function(p) {
      if (p.active !== false && p.stock <= 0) {
        notifs.push({ id:'prod_'+p.id+'_0', type:'warning', icon:'🎮', text:'<b>'+esc(p.name)+'</b> — немає на складі' });
      }
    });
  
    // Equipment maintenance
    (db.equipment||[]).forEach(function(eq) {
      if (eq.serviceInterval && eq.serviceInterval > 0) {
        var lastDate = eq.lastService ? new Date(eq.lastService) : (eq.purchaseDate ? new Date(eq.purchaseDate) : null);
        if (lastDate) {
          var next = new Date(lastDate);
          next.setDate(next.getDate() + eq.serviceInterval);
          var daysLeft = Math.ceil((next - today) / (1000*60*60*24));
          if (daysLeft < 0) {
            notifs.push({ id:'eq_'+eq.id+'_overdue', type:'danger', icon:'🔧', text:'<b>'+esc(eq.name)+'</b> — обслуговування прострочено на '+Math.abs(daysLeft)+' дн.' });
          } else if (daysLeft <= 14) {
            notifs.push({ id:'eq_'+eq.id+'_soon', type:'warning', icon:'🔧', text:'<b>'+esc(eq.name)+'</b> — обслуговування через '+daysLeft+' дн.' });
          }
        }
      }
    });
  
    // Trial ending soon (not for workers — they don't have their own subscription)
    if (window._currentUser && !window._currentUser.isWorker && window._currentUser.trialEndsAt && !window._currentUser.subscriptionEndsAt && window._currentUser.role !== 'admin') {
      var trialDays = Math.ceil((new Date(window._currentUser.trialEndsAt) - new Date()) / (1000*60*60*24));
      var warnDays = window._currentUser.promoUsed ? 10 : 7;
      if (trialDays <= warnDays && trialDays > 0) {
        notifs.push({ id:'trial_'+trialDays, type:'info', icon:'⏰', text:'Пробний період закінчується через <b>'+trialDays+' дн.</b> <a href="#" onclick="openPaymentModal();return false;" style="color:var(--primary);">Оберіть тариф →</a>' });
      }
    }
  
    // Worker: owner's access blocked
    if (window._currentUser && window._currentUser.isWorker && window._currentUser.ownerHasAccess === false) {
      notifs.push({ id:'worker_blocked', type:'warning', icon:'⚠️', text:'Ваш доступ тимчасово обмежено — керівник (<b>'+esc(window._currentUser.ownerName||'')+'</b>) ще не оновив підписку. Коли оплата буде здійснена, доступ відновиться автоматично.' });
    }
  
    // Count unread
    var unreadCount = notifs.filter(function(n){ return window._readNotifIds.indexOf(n.id) === -1; }).length;
  
    // Render
    var countEl = document.getElementById('notif-count');
    var listEl = document.getElementById('notif-list');
    var readAllBtn = document.getElementById('notif-read-all');
  
    if (notifs.length) {
      if (unreadCount > 0) {
        countEl.style.display = 'flex';
        countEl.textContent = unreadCount > 99 ? '99+' : unreadCount;
      } else {
        countEl.style.display = 'none';
      }
      if (readAllBtn) readAllBtn.style.display = unreadCount > 0 ? '' : 'none';
      listEl.innerHTML = notifs.map(function(n) {
        var isRead = window._readNotifIds.indexOf(n.id) !== -1;
        return '<div class="notif-item '+n.type+(isRead?' read':'')+'" data-nid="'+n.id+'" onclick="markNotifRead(this)"><span>'+n.icon+'</span><span>'+n.text+'</span></div>';
      }).join('');
    } else {
      countEl.style.display = 'none';
      if (readAllBtn) readAllBtn.style.display = 'none';
      listEl.innerHTML = '<div class="notif-empty" style="padding:24px 16px;text-align:center;color:var(--text-light);font-size:14px;">Все добре, немає сповіщень 🎉</div>';
    }
  }
  
  function markNotifRead(el) {
    var nid = el.getAttribute('data-nid');
    if (nid && window._readNotifIds.indexOf(nid) === -1) {
      window._readNotifIds.push(nid);
      localStorage.setItem('lipo_read_notifs', JSON.stringify(window._readNotifIds));
      el.classList.add('read');
      updateNotifBadge();
    }
  }
  
  function markAllNotifsRead() {
    document.querySelectorAll('.notif-item[data-nid]').forEach(function(el) {
      var nid = el.getAttribute('data-nid');
      if (nid && window._readNotifIds.indexOf(nid) === -1) window._readNotifIds.push(nid);
      el.classList.add('read');
    });
    localStorage.setItem('lipo_read_notifs', JSON.stringify(window._readNotifIds));
    updateNotifBadge();
  }
  
  function updateNotifBadge() {
    var all = document.querySelectorAll('.notif-item[data-nid]');
    var unread = 0;
    all.forEach(function(el){ if (!el.classList.contains('read')) unread++; });
    var countEl = document.getElementById('notif-count');
    var readAllBtn = document.getElementById('notif-read-all');
    if (unread > 0) {
      countEl.style.display = 'flex';
      countEl.textContent = unread > 99 ? '99+' : unread;
    } else {
      countEl.style.display = 'none';
    }
    if (readAllBtn) readAllBtn.style.display = unread > 0 ? '' : 'none';
  }
  
  function deleteAccount() {
    if (!confirm('Ви впевнені? Всі ваші дані будуть видалені назавжди. Цю дію неможливо скасувати.')) return;
    var confirmEmail = prompt('Для підтвердження введіть ваш email:');
    if (!confirmEmail) return;
    fetch('/api/auth/delete-account', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirmEmail: confirmEmail.trim().toLowerCase() })
    }).then(function(r){ return r.json(); }).then(function(data){
      if (data.ok) {
        alert('Акаунт видалено. Дякуємо що користувались LipoLand.');
        localStorage.removeItem(DB_KEY);
        window.location.href = '/';
      } else {
        alert(data.error || 'Помилка видалення');
      }
    }).catch(function(){ alert('Помилка з\'єднання з сервером'); });
  }
  
  // ==================== NOTIFICATION PREFERENCES ====================
  function loadNotifPrefs() {
    fetch('/api/notifications/prefs').then(function(r){ return r.json(); }).then(function(p){
      if (!p || p.error) return;
      document.getElementById('pref-email-trial-reminder').checked = p.email_trial_reminder !== false;
      document.getElementById('pref-email-trial-expired').checked = p.email_trial_expired !== false;
      document.getElementById('pref-email-sub-reminder').checked = p.email_subscription_reminder !== false;
      document.getElementById('pref-email-payment').checked = p.email_payment_confirm !== false;
      document.getElementById('pref-email-material').checked = p.email_material_alert === true;
      document.getElementById('pref-email-stock').checked = p.email_stock_alert === true;
      // Telegram
      var tgStatus = document.getElementById('telegram-status');
      var tgBoxes = document.getElementById('tg-checkboxes');
      if (p.telegram_enabled && p.telegram_chat_id) {
        tgStatus.innerHTML = '<div style="display:flex;align-items:center;gap:10px;"><span style="color:var(--success);font-size:13px;font-weight:600;">✅ Telegram підключено</span>'+
          '<button class="btn btn-danger btn-sm" onclick="disconnectTelegram()" style="font-size:11px;">Відключити</button></div>';
        tgBoxes.style.opacity = '1';
        document.getElementById('pref-tg-material').disabled = false;
        document.getElementById('pref-tg-stock').disabled = false;
        document.getElementById('pref-tg-order').disabled = false;
        document.getElementById('pref-tg-material').checked = p.telegram_material_alert === true;
        document.getElementById('pref-tg-stock').checked = p.telegram_stock_alert === true;
        document.getElementById('pref-tg-order').checked = p.telegram_order_alert === true;
      } else {
        tgStatus.innerHTML = '<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">'+
          '<span style="color:var(--text-light);font-size:13px;">Не підключено</span>'+
          '<button class="btn btn-primary btn-sm" onclick="connectTelegram()" style="font-size:12px;">🔗 Підключити Telegram</button></div>';
        tgBoxes.style.opacity = '0.5';
        document.getElementById('pref-tg-material').disabled = true;
        document.getElementById('pref-tg-stock').disabled = true;
        document.getElementById('pref-tg-order').disabled = true;
      }
    }).catch(function(){});
  }
  
  window._notifSaveTimer = null;
  function saveNotifPrefs() {
    clearTimeout(window._notifSaveTimer);
    window._notifSaveTimer = setTimeout(function() {
      var prefs = {
        email_trial_reminder: document.getElementById('pref-email-trial-reminder').checked,
        email_trial_expired: document.getElementById('pref-email-trial-expired').checked,
        email_subscription_reminder: document.getElementById('pref-email-sub-reminder').checked,
        email_payment_confirm: document.getElementById('pref-email-payment').checked,
        email_material_alert: document.getElementById('pref-email-material').checked,
        email_stock_alert: document.getElementById('pref-email-stock').checked,
        telegram_material_alert: document.getElementById('pref-tg-material').checked,
        telegram_stock_alert: document.getElementById('pref-tg-stock').checked,
        telegram_order_alert: document.getElementById('pref-tg-order').checked
      };
      fetch('/api/notifications/prefs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(prefs)
      }).then(function(){
        var el = document.getElementById('notif-save-status');
        el.style.display = 'block';
        setTimeout(function(){ el.style.display = 'none'; }, 2000);
      }).catch(function(){});
    }, 500);
  }
  
  // ==================== TELEGRAM ====================
  function connectTelegram() {
    var statusEl = document.getElementById('telegram-status');
    statusEl.innerHTML = '<span class="text-muted" style="font-size:13px;">Генеруємо посилання...</span>';
    fetch('/api/telegram/link', { method:'POST' }).then(function(r){ return r.json(); }).then(function(data){
      if (!data.ok) { statusEl.innerHTML = '<span style="color:var(--danger);font-size:13px;">Помилка: ' + (data.error||'невідомо') + '</span>'; return; }
      var botLink = 'https://t.me/' + data.botUsername + '?start=' + data.code;
      statusEl.innerHTML =
        '<div style="background:#F3E8FF;border-radius:12px;padding:16px;margin-bottom:8px;">'+
          '<p style="font-size:14px;font-weight:600;margin-bottom:8px;">Підключіть бота:</p>'+
          '<p style="font-size:13px;margin-bottom:12px;">1. Натисніть кнопку нижче<br>2. Відкриється Telegram з нашим ботом<br>3. Натисніть <b>Start</b> (Запустити)</p>'+
          '<a href="'+botLink+'" target="_blank" class="btn btn-primary" style="display:inline-flex;font-size:14px;padding:10px 20px;text-decoration:none;">📲 Відкрити Telegram-бот</a>'+
          '<p style="font-size:11px;color:var(--text-light);margin-top:10px;">Після підключення оновіть цю сторінку</p>'+
        '</div>';
    }).catch(function(){ statusEl.innerHTML = '<span style="color:var(--danger);font-size:13px;">Помилка з\'єднання</span>'; });
  }
  
  function disconnectTelegram() {
    if (!confirm('Відключити Telegram-сповіщення?')) return;
    fetch('/api/telegram/disconnect', { method:'POST' }).then(function(){ loadNotifPrefs(); }).catch(function(){});
  }

  // ВАЖЛИВО: window._currentUser/window._workerAliasMap/window._linkedWorkerNames/window._readNotifIds на window —
  // читаються з багатьох інших модулів (worker-stock, salary, clients, etc.)
  window.getCurrentWorkerAliases = getCurrentWorkerAliases;
  window.isCurrentUserWorker = isCurrentUserWorker;
  window.wLabel = wLabel;
  window.loadAccount = loadAccount;
  window.toggleAccountPanel = toggleAccountPanel;
  window.toggleNotifPanel = toggleNotifPanel;
  window.updateNotifications = updateNotifications;
  window.markNotifRead = markNotifRead;
  window.markAllNotifsRead = markAllNotifsRead;
  window.updateNotifBadge = updateNotifBadge;
  window.deleteAccount = deleteAccount;
  window.loadNotifPrefs = loadNotifPrefs;
  window.saveNotifPrefs = saveNotifPrefs;
  window.connectTelegram = connectTelegram;
  window.disconnectTelegram = disconnectTelegram;
})();
