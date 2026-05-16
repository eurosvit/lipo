// ============================================================
// LipoLand — Admin Panel module
// ============================================================
// Сторінка для admin-ролі: users list, recent registrations, promos,
// trial extend, set pro, delete user, API costs summary.

(function(){
  'use strict';

  // ==================== ADMIN PANEL ====================
  function renderAdmin() {
    if (!_currentUser || _currentUser.role !== 'admin') return;
  
    // Load costs from localStorage
    var costs = JSON.parse(localStorage.getItem('adminCosts') || '{}');
    document.getElementById('admin-cost-render').value = costs.render || 0;
    document.getElementById('admin-cost-db').value = costs.db || 0;
    document.getElementById('admin-cost-claude').value = costs.claude || 0;
    document.getElementById('admin-cost-resend').value = costs.resend || 0;
    document.getElementById('admin-cost-domain').value = costs.domain || 0;
    document.getElementById('admin-cost-other').value = costs.other || 0;
  
    // Fetch stats
    fetch('/api/admin/stats').then(function(r){ return r.json(); }).then(function(s){
      document.getElementById('admin-stat-total').textContent = s.total || 0;
      document.getElementById('admin-stat-active').textContent = s.active || 0;
      document.getElementById('admin-stat-paid').textContent = s.paid || 0;
      document.getElementById('admin-stat-new-week').textContent = s.new_this_week ? '+' + s.new_this_week + ' за тиждень' : '';
      // Update profit calc
      updateAdminCostsSummary(Number(s.paid) || 0);
    }).catch(function(){});
  
    // Fetch API usage
    fetch('/api/admin/api-usage').then(function(r){ return r.json(); }).then(function(rows){
      var total = 0;
      (rows || []).forEach(function(r){ total += Number(r.this_month) || 0; });
      document.getElementById('admin-stat-api').textContent = total;
    }).catch(function(){});
  
    // Fetch users
    fetch('/api/admin/users').then(function(r){ return r.json(); }).then(function(users){
      renderAdminUsers(users || []);
      renderAdminRecentReg(users || []);
    }).catch(function(){});
  
    // Fetch promo codes
    fetch('/api/admin/promo').then(function(r){ return r.json(); }).then(function(promos){
      renderAdminPromos(promos || []);
    }).catch(function(){});
  
    // Fetch announcements
    loadAdminAnnouncements();
  }
  
  function updateAdminCostsSummary(paidCount) {
    var costs = JSON.parse(localStorage.getItem('adminCosts') || '{}');
    var total = (Number(costs.render)||0) + (Number(costs.db)||0) + (Number(costs.claude)||0) + (Number(costs.resend)||0) + (Number(costs.domain)||0) + (Number(costs.other)||0);
    // Estimate revenue: середнє ~250 грн/month per paid user
    var revenuePerUser = 250;
    var revenue = (paidCount || 0) * revenuePerUser;
    var profit = revenue - total;
    document.getElementById('admin-costs-total').textContent = fmt(total) + ' грн';
    document.getElementById('admin-costs-revenue').textContent = fmt(revenue) + ' грн';
    var profitEl = document.getElementById('admin-costs-profit');
    profitEl.textContent = fmt(profit) + ' грн';
    profitEl.style.color = profit >= 0 ? 'var(--success)' : '#F44336';
  }
  
  function saveAdminCosts() {
    var costs = {
      render: Number(document.getElementById('admin-cost-render').value) || 0,
      db: Number(document.getElementById('admin-cost-db').value) || 0,
      claude: Number(document.getElementById('admin-cost-claude').value) || 0,
      resend: Number(document.getElementById('admin-cost-resend').value) || 0,
      domain: Number(document.getElementById('admin-cost-domain').value) || 0,
      other: Number(document.getElementById('admin-cost-other').value) || 0
    };
    localStorage.setItem('adminCosts', JSON.stringify(costs));
    var el = document.getElementById('admin-costs-saved');
    el.style.display = 'block';
    setTimeout(function(){ el.style.display = 'none'; }, 2000);
    // Re-calc with current paid count
    var paidText = document.getElementById('admin-stat-paid').textContent;
    updateAdminCostsSummary(Number(paidText) || 0);
  }
  
  function renderAdminUsers(users) {
    var now = new Date();
    var html = '<table class="data-table" style="width:100%;font-size:13px;"><thead><tr>' +
      '<th>Ім\'я</th><th>Email</th><th>Тип</th><th>Статус</th><th>Тріал до</th><th>Підписка до</th><th>Промо</th><th>Реєстрація</th><th>Останній вхід</th><th>Дії</th>' +
      '</tr></thead><tbody>';
    users.forEach(function(u) {
      var status = '', statusClass = '', statusTitle = '';
      var worksForPre = Array.isArray(u.works_for) ? u.works_for : [];
      var hasOwnPro = u.subscription_ends_at && new Date(u.subscription_ends_at) > now;
      var hasOwnTrial = u.trial_ends_at && new Date(u.trial_ends_at) > now;
      var isActiveWorker = worksForPre.length > 0;
  
      if (u.role === 'admin') {
        status = 'Адмін'; statusClass = 'color:var(--primary);font-weight:600;';
      } else if (hasOwnPro) {
        status = 'PRO' + (isActiveWorker ? ' + 👷' : '');
        statusClass = 'color:var(--success);font-weight:600;';
        if (isActiveWorker) statusTitle = 'Має власну PRO-підписку і також є майстром';
      } else if (isActiveWorker) {
        // Майстер без власної PRO — доступ через власника, власний тріал не застосовується
        status = '👷 Майстер';
        statusClass = 'color:#E65100;font-weight:600;';
        statusTitle = 'Доступ через підписку власника. Власний тріал — ' + (hasOwnTrial ? 'активний до ' + new Date(u.trial_ends_at).toLocaleDateString('uk-UA') + ' (не використовується)' : 'закінчився');
      } else if (hasOwnTrial) {
        status = 'Тріал'; statusClass = 'color:#FF9800;font-weight:600;';
      } else {
        status = 'Закінчився'; statusClass = 'color:#999;';
      }
  
      var trialDate = u.trial_ends_at ? new Date(u.trial_ends_at).toLocaleDateString('uk-UA') : '—';
      var subDate = u.subscription_ends_at ? new Date(u.subscription_ends_at).toLocaleDateString('uk-UA') : '—';
      var regDate = u.created_at ? new Date(u.created_at).toLocaleDateString('uk-UA') : '—';
      var lastLogin = u.last_login_at ? timeAgo(new Date(u.last_login_at)) : 'ніколи';
  
      // Тип: адмін / власник / майстер (+ у кого працює) / власник+майстер
      var worksFor = Array.isArray(u.works_for) ? u.works_for : [];
      var workersCount = u.workers_count || 0;
      var typeHtml;
      if (u.role === 'admin') {
        typeHtml = '<span style="color:var(--primary);font-weight:600;">👑 Адмін</span>';
      } else {
        var parts = [];
        // Every user row exists — by default "власник" (has own account)
        if (workersCount > 0) {
          parts.push('<span style="color:#6A1B9A;font-weight:600;" title="Має своїх майстрів">👤 Власник <span style="font-size:11px;color:#999;font-weight:400;">(майстрів: '+workersCount+')</span></span>');
        } else {
          parts.push('<span style="color:#555;">👤 Власник</span>');
        }
        if (worksFor.length > 0) {
          var ownersList = worksFor.map(function(w){
            var label = w.workerName || w.ownerName || w.ownerEmail;
            var tip = 'У: ' + (w.ownerName || '') + ' <' + w.ownerEmail + '>';
            return '<span title="'+esc(tip)+'" style="display:inline-block;background:#FFF3E0;color:#E65100;border:1px solid #FFCC80;border-radius:10px;padding:1px 6px;font-size:11px;margin:1px;">👷 ' + esc(w.ownerName || w.ownerEmail.split('@')[0]) + '</span>';
          }).join(' ');
          parts.push('<div style="margin-top:2px;">Майстер у: '+ownersList+'</div>');
        }
        typeHtml = parts.join('');
      }
  
      html += '<tr>' +
        '<td>' + esc(u.name || '—') + '</td>' +
        '<td style="font-size:12px;">' + esc(u.email) + '</td>' +
        '<td style="font-size:12px;">' + typeHtml + '</td>' +
        '<td style="' + statusClass + '"' + (statusTitle ? ' title="' + esc(statusTitle) + '"' : '') + '>' + status + '</td>' +
        '<td style="font-size:12px;">' + trialDate + '</td>' +
        '<td style="font-size:12px;">' + subDate + '</td>' +
        '<td style="font-size:12px;">' + esc(u.promo_used || '—') + '</td>' +
        '<td style="font-size:12px;">' + regDate + '</td>' +
        '<td style="font-size:12px;">' + lastLogin + '</td>' +
        '<td style="white-space:nowrap;">';
      if (u.role !== 'admin') {
        var isPureWorker = isActiveWorker && !hasOwnPro;
        var trashSvg = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>';
        var trashStyle = 'font-size:11px;padding:4px 8px;margin:2px;background:#FEE2E2;color:#991B1B;border:1px solid #FCA5A5;';
        if (isPureWorker) {
          // Для чистого майстра тріал/PRO не впливають на доступ — ховаємо
          html += '<span style="font-size:11px;color:#999;font-style:italic;margin-right:6px;" title="Доступ майстра — через підписку власника. Для відокремлення — див. процедуру \'майстер→власник\' у підтримці.">керує власник</span>';
          html += '<button class="btn btn-sm" onclick="adminDeleteUser(\'' + u.id + '\',\'' + esc(u.name||u.email) + '\')" style="' + trashStyle + '" title="⚠ Видалить акаунт і розірве звʼязок з власницею">' + trashSvg + '</button>';
        } else {
          html += '<button class="btn btn-sm" onclick="adminExtendTrial(\'' + u.id + '\',\'' + esc(u.name||u.email) + '\')" style="font-size:11px;padding:4px 8px;margin:2px;">+Тріал</button>';
          html += '<button class="btn btn-sm" onclick="adminSetPro(\'' + u.id + '\',\'' + esc(u.name||u.email) + '\')" style="font-size:11px;padding:4px 8px;margin:2px;background:var(--success);color:#fff;">PRO</button>';
          html += '<button class="btn btn-sm" onclick="adminDeleteUser(\'' + u.id + '\',\'' + esc(u.name||u.email) + '\')" style="' + trashStyle + '" title="Видалити користувача">' + trashSvg + '</button>';
        }
      }
      html += '</td></tr>';
    });
    html += '</tbody></table>';
    document.getElementById('admin-users-table').innerHTML = html;
  }
  
  function renderAdminRecentReg(users) {
    var recent = users.filter(function(u){ return u.role !== 'admin'; }).slice(0, 10);
    if (!recent.length) { document.getElementById('admin-recent-reg').innerHTML = '<p style="color:var(--text-light);font-size:13px;">Немає реєстрацій</p>'; return; }
    var html = '';
    recent.forEach(function(u) {
      var d = u.created_at ? new Date(u.created_at) : new Date();
      var ago = timeAgo(d);
      html += '<div style="display:flex;align-items:center;gap:12px;padding:8px 0;border-bottom:1px solid var(--border);">' +
        '<div style="width:36px;height:36px;border-radius:50%;background:var(--primary);color:#fff;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:14px;">' + esc((u.name||u.email||'?').charAt(0).toUpperCase()) + '</div>' +
        '<div style="flex:1;"><div style="font-weight:600;font-size:13px;">' + esc(u.name || '—') + '</div><div style="font-size:12px;color:var(--text-light);">' + esc(u.email) + (u.promo_used ? ' • промо: ' + esc(u.promo_used) : '') + '</div></div>' +
        '<div style="font-size:11px;color:var(--text-light);">' + ago + '</div>' +
        '</div>';
    });
    document.getElementById('admin-recent-reg').innerHTML = html;
  }
  
  function timeAgo(date) {
    var s = Math.floor((new Date() - date) / 1000);
    if (s < 60) return s + ' сек тому';
    var m = Math.floor(s / 60);
    if (m < 60) return m + ' хв тому';
    var h = Math.floor(m / 60);
    if (h < 24) return h + ' год тому';
    var d = Math.floor(h / 24);
    if (d < 30) return d + ' дн тому';
    return date.toLocaleDateString('uk-UA');
  }
  
  function renderAdminPromos(promos) {
    if (!promos.length) { document.getElementById('admin-promo-table').innerHTML = '<p style="color:var(--text-light);font-size:13px;">Немає промокодів</p>'; return; }
    var html = '<table class="data-table" style="width:100%;font-size:13px;"><thead><tr><th>Код</th><th>Днів</th><th>Макс.</th><th>Використано</th><th>Активний</th><th>Створено</th><th>Дія</th></tr></thead><tbody>';
    promos.forEach(function(p) {
      var created = p.created_at ? new Date(p.created_at).toLocaleDateString('uk-UA') : '—';
      html += '<tr>' +
        '<td style="font-weight:600;">' + esc(p.code) + '</td>' +
        '<td>' + p.free_days + '</td>' +
        '<td>' + (p.max_uses || '∞') + '</td>' +
        '<td>' + p.used_count + '</td>' +
        '<td style="color:' + (p.active ? 'var(--success)' : '#999') + ';font-weight:600;">' + (p.active ? '✅' : '❌') + '</td>' +
        '<td style="font-size:12px;">' + created + '</td>' +
        '<td><button class="btn btn-sm" onclick="toggleAdminPromo(\'' + esc(p.code) + '\')" style="font-size:11px;padding:4px 8px;">' + (p.active ? 'Вимкнути' : 'Увімкнути') + '</button></td>' +
        '</tr>';
    });
    html += '</tbody></table>';
    document.getElementById('admin-promo-table').innerHTML = html;
  }
  
  function createAdminPromo() {
    var code = document.getElementById('admin-promo-code').value.trim().toUpperCase();
    var days = Number(document.getElementById('admin-promo-days').value) || 30;
    var maxUses = Number(document.getElementById('admin-promo-max').value) || null;
    if (!code) return alert('Введіть код');
    fetch('/api/admin/promo', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({code:code, freeDays:days, maxUses:maxUses}) })
      .then(function(r){ return r.json(); }).then(function(d){
        if (d.ok) { document.getElementById('admin-promo-code').value = ''; renderAdmin(); }
        else alert(d.error || 'Помилка');
      }).catch(function(){ alert('Помилка мережі'); });
  }
  
  function toggleAdminPromo(code) {
    fetch('/api/admin/promo-toggle', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({code:code}) })
      .then(function(r){ return r.json(); }).then(function(d){
        if (d.ok) renderAdmin();
        else alert(d.error || 'Помилка');
      }).catch(function(){ alert('Помилка мережі'); });
  }
  
  function adminExtendTrial(userId, name) {
    var days = prompt('Подовжити тріал для ' + name + '.\nСкільки днів додати?', '14');
    if (!days || isNaN(days)) return;
    fetch('/api/admin/extend-trial', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({userId:userId, days:Number(days)}) })
      .then(function(r){ return r.json(); }).then(function(d){
        if (d.ok) { alert('Тріал подовжено на ' + days + ' днів'); renderAdmin(); }
        else alert(d.error || 'Помилка');
      }).catch(function(){ alert('Помилка мережі'); });
  }
  
  function adminSetPro(userId, name) {
    var months = prompt('Дати PRO підписку для ' + name + '.\nСкільки місяців?', '1');
    if (!months || isNaN(months)) return;
    fetch('/api/admin/set-subscription', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({userId:userId, months:Number(months)}) })
      .then(function(r){ return r.json(); }).then(function(d){
        if (d.ok) { alert('PRO підписка активована на ' + months + ' міс.'); renderAdmin(); }
        else alert(d.error || 'Помилка');
      }).catch(function(){ alert('Помилка мережі'); });
  }
  
  function adminDeleteUser(userId, name) {
    if (!confirm('Видалити користувача ' + name + ' та всі його дані?\n\nЦю дію неможливо відмінити!')) return;
    fetch('/api/admin/delete-user', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({userId:userId}) })
      .then(function(r){ return r.json(); }).then(function(d){
        if (d.ok) { alert('Користувача видалено'); renderAdmin(); }
        else alert(d.error || 'Помилка');
      }).catch(function(){ alert('Помилка мережі'); });
  }

  window.renderAdmin = renderAdmin;
  window.updateAdminCostsSummary = updateAdminCostsSummary;
  window.saveAdminCosts = saveAdminCosts;
  window.renderAdminUsers = renderAdminUsers;
  window.renderAdminRecentReg = renderAdminRecentReg;
  window.timeAgo = timeAgo;
  window.renderAdminPromos = renderAdminPromos;
  window.createAdminPromo = createAdminPromo;
  window.toggleAdminPromo = toggleAdminPromo;
  window.adminExtendTrial = adminExtendTrial;
  window.adminSetPro = adminSetPro;
  window.adminDeleteUser = adminDeleteUser;
})();
