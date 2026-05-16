// ============================================================
// LipoLand — Linked Workers + Permissions module
// ============================================================
// Запрошення майстрів за email, ставлення прав, перейменування alias,
// видалення. + applyWorkerPermissions (фільтр nav за роллю майстра).

(function(){
  'use strict';

  // ==================== LINKED WORKERS (ONLINE) ====================
  function loadLinkedWorkers() {
    return fetch('/api/workers').then(function(r){ return r.json(); }).then(function(data){
      if (data.error) return;
      // Save linked worker names + owner aliases for use in dropdowns/labels
      _linkedWorkerNames = [];
      _workerAliasMap = {};
      (data.workers || []).forEach(function(w){
        var realName = w.worker_name || w.user_name || '';
        if (!realName) return;
        _linkedWorkerNames.push(realName);
        if (w.owner_alias) _workerAliasMap[realName] = w.owner_alias;
      });
      renderLinkedWorkers(data.workers || [], data.pendingInvites || []);
      // Re-render currently active page so worker dropdowns (Orders, Salary, Production etc.) pick up the names.
      // Without this, after a fresh page load the dropdowns are empty until the user visits Settings.
      try {
        var activePage = document.querySelector('.page.active');
        if (activePage && activePage.id && typeof renderPage === 'function') renderPage(activePage.id);
      } catch(e) {}
    }).catch(function(){});
  }
  
  function renderLinkedWorkers(workers, invites) {
    var listEl = document.getElementById('linked-workers-list');
    if (!listEl) return;
  
    if (workers.length) {
      var permLabels = {
        dashboard:'📊 Дашборд', orders:'📋 Замовлення', production:'🔧 Виробництво',
        workerStock:'📦 Склад майстрів', materials:'🧵 Матеріали (залишки)',
        materialPrices:'💰 Ціни матеріалів', sellPrices:'🏷 Ціни продажу',
        costs:'📈 Собівартість', expenses:'💸 Витрати', salary:'💵 ЗП', equipment:'🖨 Обладнання', settings:'⚙️ Налаштування'
      };
      listEl.innerHTML = workers.map(function(w) {
        var perms = w.permissions || {};
        var permHtml = Object.keys(permLabels).map(function(key) {
          var checked = perms[key] ? 'checked' : '';
          return '<label style="display:flex;align-items:center;gap:4px;font-size:12px;cursor:pointer;min-width:170px;">'+
            '<input type="checkbox" '+checked+' onchange="updateWorkerPerm(\''+w.id+'\',\''+key+'\',this.checked,event)"> '+permLabels[key]+'</label>';
        }).join('');
        // Diagnostic: show currently saved permissions (from DB)
        var activeList = Object.keys(permLabels).filter(function(k){return perms[k]===true}).map(function(k){return permLabels[k].replace(/^[^\s]+\s/,'')}).join(', ') || '—';
        var dbHint = '<div class="worker-perm-hint" style="font-size:10px;color:#999;margin-top:4px;font-style:italic;">🔍 В базі зараз: '+esc(activeList)+'</div>';
        var realName = w.worker_name || w.user_name || '—';
        var displayName = w.owner_alias || realName;
        var hasAlias = !!(w.owner_alias && w.owner_alias !== realName);
        var aliasHint = hasAlias
          ? '<div style="font-size:11px;color:var(--text-light);margin-top:2px;">👤 Справжнє ім\'я: <em>'+esc(realName)+'</em> · вона не бачить цього прізвиська</div>'
          : '';
        return '<div class="worker-perm-card" style="border:1px solid var(--border);border-radius:8px;padding:12px;margin-bottom:8px;">'+
          '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;gap:8px;flex-wrap:wrap;">'+
            '<div style="flex:1;min-width:200px;">'+
              '<strong>'+ esc(displayName) +'</strong> '+
              '<button class="btn btn-outline btn-sm" style="padding:2px 8px;font-size:11px;margin-left:4px;" title="Перейменувати (лише для вас)" onclick="renameLinkedWorker(\''+w.id+'\',\''+esc(displayName).replace(/\x27/g,"\\\x27")+'\')">✏️</button> '+
              '<span class="text-muted" style="font-size:12px;">'+esc(w.email)+'</span>'+
              aliasHint +
            '</div>'+
            '<button class="btn btn-danger btn-sm" onclick="removeLinkedWorker(\''+w.id+'\')">✕ Відключити</button>'+
          '</div>'+
          '<div style="display:flex;flex-wrap:wrap;gap:6px 12px;">'+permHtml+'</div>'+
          dbHint +
        '</div>';
      }).join('');
    } else {
      listEl.innerHTML = '<p class="text-muted" style="font-size:13px;">Немає підключених майстрів</p>';
    }
  
    var invEl = document.getElementById('pending-invites-list');
    if (invEl && invites.length) {
      invEl.innerHTML = '<div class="section-title" style="font-size:13px;margin-top:8px;">⏳ Очікують реєстрацію:</div>' +
        invites.map(function(inv) {
          return '<div style="display:flex;align-items:center;gap:8px;padding:4px 0;font-size:13px;">'+
            '<span>'+esc(inv.email)+'</span>'+
            '<span class="badge badge-warning">очікує</span>'+
            '<button class="btn btn-danger btn-sm" style="padding:2px 8px;font-size:11px;" onclick="cancelInvite(\''+inv.id+'\')">✕</button>'+
          '</div>';
        }).join('');
    } else if (invEl) {
      invEl.innerHTML = '';
    }
  }
  
  function inviteWorker() {
    var email = v('invite-worker-email').trim();
    var name = v('invite-worker-name').trim();
    if (!email) return alert('Вкажіть email майстра');
    var resultEl = document.getElementById('invite-result');
    resultEl.innerHTML = '<span class="text-muted">Запрошуємо...</span>';
  
    fetch('/api/workers/invite', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ email: email, name: name })
    }).then(function(r){ return r.json(); }).then(function(data){
      if (data.error) { resultEl.innerHTML = '<span class="text-danger">'+esc(data.error)+'</span>'; return; }
      var priceNote = '<div style="margin-top:10px;padding:10px 12px;background:#FFF3E0;border-left:3px solid #FB8C00;border-radius:6px;font-size:13px;color:#5D4037;">💡 <b>До відома:</b> підключення майстра коштує <b>+100 грн/міс</b>. Доплату не знімаємо зараз — до кінця вашої поточної підписки майстер працює безкоштовно. З наступного продовження вартість складатиме на 100 грн більше за кожного активного майстра.</div>';
      if (data.linked) {
        resultEl.innerHTML = '<span class="text-success">✅ Майстер підключений! Вона вже зареєстрована в системі.</span>' + priceNote;
      } else {
        resultEl.innerHTML = '<span class="text-success">✅ Запрошення створено! Коли <b>'+esc(email)+'</b> зареєструється на lipoland.top — вона автоматично підключиться до вашого акаунту.</span>' + priceNote;
      }
      document.getElementById('invite-worker-email').value = '';
      document.getElementById('invite-worker-name').value = '';
      loadLinkedWorkers();
      // Refresh connectedWorkersCount for immediate price updates in payment modal
      loadAccount();
    }).catch(function(){ resultEl.innerHTML = '<span class="text-danger">Помилка з\'єднання</span>'; });
  }
  
  function updateWorkerPerm(linkId, key, value, ev) {
    var e = ev || (typeof event !== 'undefined' ? event : null);
    var target = e && e.target;
    var card = target ? target.closest('.worker-perm-card') : null;
    if (!card) { console.error('[perm save] card not found', e); alert('Технічна помилка (card not found). Напишіть в підтримку.'); return; }
    // Read perms by KEY from each checkbox's onchange attribute (robust to HTML/JS version drift).
    var perms = {};
    card.querySelectorAll('input[type="checkbox"]').forEach(function(cb) {
      var oc = cb.getAttribute('onchange') || '';
      var m = oc.match(/updateWorkerPerm\([^,]+,\s*'([^']+)'/);
      if (m) perms[m[1]] = cb.checked;
    });
    // Safety net: ensure the key being toggled is recorded even if attribute parsing failed.
    if (key) perms[key] = value;
  
    fetch('/api/workers/permissions', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ linkId: linkId, permissions: perms })
    }).then(function(r){ return r.json().then(function(b){ return {status:r.status, body:b}; }); })
      .then(function(w){
        if (w.status === 200 && w.body.ok) {
          // Update diagnostic line in place without re-rendering (avoids interrupting rapid clicks)
          var hintEl = card.querySelector('.worker-perm-hint');
          if (hintEl) {
            var permLabels = {
              dashboard:'📊 Дашборд', orders:'📋 Замовлення', production:'🔧 Виробництво',
              workerStock:'📦 Склад майстрів', materials:'🧵 Матеріали (залишки)',
              materialPrices:'💰 Ціни матеріалів', sellPrices:'🏷 Ціни продажу',
              costs:'📈 Собівартість', expenses:'💸 Витрати', salary:'💵 ЗП', equipment:'🖨 Обладнання', settings:'⚙️ Налаштування'
            };
            var activeList = Object.keys(permLabels).filter(function(k){return perms[k]===true}).map(function(k){return permLabels[k].replace(/^[^\s]+\s/,'')}).join(', ') || '—';
            hintEl.textContent = '🔍 В базі зараз: ' + activeList;
          }
        } else {
          alert('❌ Не вдалось зберегти права: ' + (w.body.error || 'HTTP '+w.status));
          console.error('[perm save]', w);
        }
      })
      .catch(function(e){
        alert('❌ Помилка з\'єднання при збереженні прав: ' + e.message);
        console.error('[perm save]', e);
      });
  }
  
  function removeLinkedWorker(linkId) {
    if (!confirm('Відключити цього майстра? Вона більше не зможе бачити ваші дані.\n\nВартість підписки зменшиться на 100 грн/міс з наступного продовження.')) return;
    fetch('/api/workers/remove', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ linkId: linkId })
    }).then(function(){ loadLinkedWorkers(); loadAccount(); }).catch(function(){});
  }
  
  function renameLinkedWorker(linkId, currentName) {
    var newName = prompt('Нове ім\'я для майстра (бачите лише ви — вона ні):', currentName || '');
    if (newName === null) return; // cancelled
    newName = newName.trim();
    fetch('/api/workers/rename', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ linkId: linkId, name: newName })
    }).then(function(r){ return r.json(); }).then(function(data){
      if (data && data.error) { alert(data.error); return; }
      // Refresh linked workers (this repopulates _workerAliasMap)
      fetch('/api/workers').then(function(r){ return r.json(); }).then(function(d){
        if (d.error) return;
        _linkedWorkerNames = [];
        _workerAliasMap = {};
        (d.workers || []).forEach(function(w){
          var realName = w.worker_name || w.user_name || '';
          if (!realName) return;
          _linkedWorkerNames.push(realName);
          if (w.owner_alias) _workerAliasMap[realName] = w.owner_alias;
        });
        renderLinkedWorkers(d.workers || [], d.pendingInvites || []);
        // Re-render any pages that display worker names, so alias shows up live
        try { if (typeof renderOrders === 'function') renderOrders(); } catch(e) {}
        try { if (typeof renderProduction === 'function') renderProduction(); } catch(e) {}
        try { if (typeof renderSalary === 'function') renderSalary(); } catch(e) {}
        try { if (typeof renderWorkerStock === 'function') renderWorkerStock(); } catch(e) {}
        try { if (typeof renderAnalytics === 'function') renderAnalytics(); } catch(e) {}
      });
    }).catch(function(){ alert('Помилка з\'єднання'); });
  }
  
  function cancelInvite(inviteId) {
    fetch('/api/workers/cancel-invite', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ inviteId: inviteId })
    }).then(function(){ loadLinkedWorkers(); loadAccount(); }).catch(function(){});
  }
  

  // ==================== WORKER ROLE (PERMISSION FILTERING) ====================
  function applyWorkerPermissions() {
    if (!_currentUser || !_currentUser.isWorker) return;
    var p = _currentUser.workerPermissions || {};
  
    // Hide nav buttons based on permissions
    var navMap = {
      'dashboard': p.dashboard !== false,
      'materials': p.materials === true,
      'products': false, // workers don't manage product catalog
      'production': p.production === true,
      'orders': p.orders === true,
      'worker-stock': p.workerStock === true,
      'salary': p.salary === true,
      'costs': p.costs === true,
      'expenses': p.expenses === true,
      'equipment': p.equipment === true,
      'analytics': false, // workers don't see analytics
      'settings': p.settings === true
    };
  
    document.querySelectorAll('.nav-links button[data-page], .nav button[data-page], .mobile-nav button[data-page]').forEach(function(btn) {
      var page = btn.getAttribute('data-page');
      if (navMap[page] === false) {
        btn.style.display = 'none';
      } else if (navMap[page] === true) {
        btn.style.display = '';
      }
      // Rename "Майстри" to "Мій склад" for worker
      if (page === 'worker-stock') btn.innerHTML = '📦 Мої матеріали';
    });
  
    // Mobile menu panel (no data-page attr — matched by mobileNav('page') in onclick)
    document.querySelectorAll('.mobile-menu-panel button[onclick*="mobileNav"]').forEach(function(btn) {
      var m = btn.getAttribute('onclick').match(/mobileNav\('([^']+)'\)/);
      if (!m) return;
      var page = m[1];
      if (navMap[page] === false) {
        btn.style.display = 'none';
      } else if (navMap[page] === true) {
        btn.style.display = '';
      }
      if (page === 'worker-stock') btn.textContent = '📦 Мої матеріали';
    });
  
    // Hide linked workers card (only for owners)
    var lwCard = document.getElementById('linked-workers-card');
    if (lwCard) lwCard.style.display = 'none';
  
    // Update worker info banner (already in DOM)
    var banner = document.getElementById('worker-banner');
    if (banner) {
      var _aliases = getCurrentWorkerAliases();
      var _diag = _aliases.length ? '' : ' <span style="font-size:11px;color:#c00;">· УВАГА: список імен порожній — зверніться до власника</span>';
      banner.innerHTML = '👩‍🔧 Ви працюєте як майстер у <b>' + esc(_currentUser.ownerName || '—') + '</b>' + _diag;
      banner.style.display = 'block';
    }
  
    // If costs hidden, also hide cost columns in products table
    if (!p.costs && !p.sellPrices) {
      var style = document.createElement('style');
      style.textContent = '.worker-hide-prices { display:none !important; }';
      document.head.appendChild(style);
    }
  }
  

  window.loadLinkedWorkers = loadLinkedWorkers;
  window.renderLinkedWorkers = renderLinkedWorkers;
  window.inviteWorker = inviteWorker;
  window.updateWorkerPerm = updateWorkerPerm;
  window.removeLinkedWorker = removeLinkedWorker;
  window.renameLinkedWorker = renameLinkedWorker;
  window.cancelInvite = cancelInvite;
  window.applyWorkerPermissions = applyWorkerPermissions;
})();
