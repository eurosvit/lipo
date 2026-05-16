// ============================================================
// LipoLand — Feature Toggles module
// ============================================================
// Onboarding wizard + Settings → перемикачі функцій.
// Керує видимістю nav-кнопок та .feat-* елементів.
// Глобали: _currentUser, toggleCrmVisibility (з sales-drive sync — поки в index).

(function(){
  'use strict';

  // ==================== FEATURE TOGGLES ====================
  function getFeatures() {
    var defaults = { workers:false, production:true, orders:true, fulfillment:false, crm:false, equipment:false, costs:true };
    try {
      var saved = JSON.parse(localStorage.getItem('lipo_features'));
      if (saved) {
        for (var k in defaults) { if (saved[k] === undefined) saved[k] = defaults[k]; }
        return saved;
      }
    } catch(e) {}
    return defaults;
  }
  
  function saveFeatures(features) {
    localStorage.setItem('lipo_features', JSON.stringify(features));
    applyFeatures();
  }
  
  function isFeatureOn(id) {
    return getFeatures()[id] !== false;
  }
  
  var _onboardingFeatures = [
    { id:'production', icon:'\u{1F3ED}', name:'Виробництво', desc:'Запуск в роботу, здача готової продукції, контроль процесу', default:true },
    { id:'orders', icon:'\u{1F4E6}', name:'Замовлення', desc:'Облік замовлень клієнтів, відправка, трекінг посилок', default:true },
    { id:'workers', icon:'\u{1F477}', name:'Команда', desc:'Робота з майстрами, зарплата, склад майстрів', default:false },
    { id:'fulfillment', icon:'\u{1F3EC}', name:'Фулфілмент', desc:'Передача товарів на зовнішні склади (Розетка, Prom тощо)', default:false },
    { id:'costs', icon:'\u{1F4B0}', name:'Витрати', desc:'Облік витрат та видатків на бізнес', default:true },
    { id:'equipment', icon:'\u{1F527}', name:'Обладнання', desc:'Облік обладнання, сервісний журнал', default:false },
    { id:'crm', icon:'\u{1F517}', name:'CRM інтеграція', desc:'Синхронізація із SalesDrive CRM', default:false }
  ];
  
  function applyFeatures() {
    var f = getFeatures();
    // For workers, nav visibility is controlled by permissions, not feature toggles.
    // Skip nav hiding — applyWorkerPermissions() handles it.
    var isWorker = _currentUser && _currentUser.isWorker;
    if (!isWorker) {
      // Hide/show nav buttons by data-page
      var navMap = {
        'worker-stock': 'workers',
        'production': 'production',
        'orders': 'orders',
        'salary': 'workers',
        'expenses': 'costs',
        'equipment': 'equipment'
      };
      document.querySelectorAll('.nav-links button[data-page]').forEach(function(btn) {
        var page = btn.getAttribute('data-page');
        var feat = navMap[page];
        if (feat) {
          btn.style.display = f[feat] ? '' : 'none';
        }
      });
      // Mobile nav buttons
      document.querySelectorAll('.mobile-menu-panel button[onclick*="mobileNav"]').forEach(function(btn) {
        var match = btn.getAttribute('onclick').match(/mobileNav\('([^']+)'\)/);
        if (match) {
          var page = match[1];
          var feat = navMap[page];
          if (feat) {
            btn.style.display = f[feat] ? '' : 'none';
          }
        }
      });
    }
    // Handle feat-* classed elements
    var ids = ['workers','production','orders','fulfillment','crm','equipment','costs'];
    ids.forEach(function(id) {
      var els = document.querySelectorAll('.feat-'+id);
      for (var i = 0; i < els.length; i++) {
        els[i].style.display = f[id] ? '' : 'none';
      }
    });
    // Re-apply CRM visibility (respects both feature toggle and key presence)
    toggleCrmVisibility();
  }
  
  function showFeatureWizard() {
    var container = document.getElementById('feat-wizard-options');
    container.innerHTML = _onboardingFeatures.map(function(feat) {
      var f = getFeatures();
      var checked = f[feat.id];
      return '<label style="display:flex;align-items:center;gap:12px;padding:12px 16px;background:var(--bg);border-radius:12px;cursor:pointer;border:2px solid '+(checked?'var(--primary)':'transparent')+';transition:all .2s;" '+
        'onmouseover="this.style.borderColor=\'var(--primary-light)\'" onmouseout="this.style.borderColor=this.querySelector(\'input\').checked?\'var(--primary)\':\'transparent\'">' +
        '<input type="checkbox" data-feat="'+feat.id+'" '+(checked?'checked':'')+' style="width:20px;height:20px;accent-color:var(--primary);" onchange="this.closest(\'label\').style.borderColor=this.checked?\'var(--primary)\':\'transparent\'">' +
        '<span style="font-size:24px;">'+feat.icon+'</span>' +
        '<div style="flex:1;"><strong style="font-size:15px;">'+feat.name+'</strong><br><span style="font-size:12px;color:var(--text-light);">'+feat.desc+'</span></div>' +
      '</label>';
    }).join('');
    document.getElementById('feat-wizard-modal').style.display = 'flex';
  }
  
  function finishFeatureWizard() {
    var features = {};
    document.querySelectorAll('#feat-wizard-options input[data-feat]').forEach(function(cb) {
      features[cb.getAttribute('data-feat')] = cb.checked;
    });
    saveFeatures(features);
    localStorage.setItem('lipo_features_configured', '1');
    document.getElementById('feat-wizard-modal').style.display = 'none';
  }
  
  function checkFeatureWizard() {
    if (!localStorage.getItem('lipo_features_configured')) {
      showFeatureWizard();
    }
  }
  
  function renderSettingsFeatures() {
    var f = getFeatures();
    var container = document.getElementById('settings-features');
    if (!container) return;
    container.innerHTML = _onboardingFeatures.map(function(feat) {
      var on = !!f[feat.id];
      return '<div onclick="toggleFeatureSetting(\''+feat.id+'\')" style="display:flex;align-items:center;gap:10px;padding:10px 14px;background:var(--bg);border-radius:10px;cursor:pointer;user-select:none;">' +
        '<span style="display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;border-radius:5px;border:2px solid '+(on?'var(--primary)':'#bbb')+';background:'+(on?'var(--primary)':'#fff')+';color:#fff;font-size:13px;font-weight:bold;flex-shrink:0;">'+(on?'✓':'')+'</span>' +
        '<span style="font-size:20px;">'+feat.icon+'</span>' +
        '<div><strong style="font-size:14px;">'+feat.name+'</strong> <span style="font-size:12px;color:var(--text-light);">\u2014 '+feat.desc+'</span></div>' +
      '</div>';
    }).join('');
  }
  
  function toggleFeatureSetting(id, forced) {
    var f = getFeatures();
    if (typeof forced === 'boolean') {
      f[id] = forced;
    } else {
      f[id] = !f[id];
    }
    saveFeatures(f);
    renderSettingsFeatures();
  }

  // Експорт — applyFeatures викликається на init, getFeatures/saveFeatures —
  // з налаштувань, isFeatureOn — з різних місць, showFeatureWizard — з onboarding.
  window.getFeatures = getFeatures;
  window.saveFeatures = saveFeatures;
  window.isFeatureOn = isFeatureOn;
  window.applyFeatures = applyFeatures;
  window.showFeatureWizard = showFeatureWizard;
  window.finishFeatureWizard = finishFeatureWizard;
  window.checkFeatureWizard = checkFeatureWizard;
  window.renderSettingsFeatures = renderSettingsFeatures;
  window.toggleFeatureSetting = toggleFeatureSetting;
})();
