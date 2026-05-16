// ============================================================
// LipoLand — Onboarding tour module
// ============================================================
// Welcome-тур для нових користувачів (?welcome=1 в URL).
// Після завершення відкривається showFeatureWizard.

(function(){
  'use strict';

  // ==================== ONBOARDING ====================
  window.onbSteps = [
    {
      icon: '👋',
      title: 'Ласкаво просимо до LipoLand!',
      subtitle: 'Перша спеціалізована CRM для виробництва липучкових книжок в Україні',
      body: '<div style="text-align:center;padding:16px 0;"><p style="font-size:16px;color:var(--text);line-height:1.6;">Ми допоможемо вам вести облік матеріалів, рахувати собівартість, управляти замовленнями та контролювати виробництво.</p><p style="margin-top:16px;font-size:14px;color:var(--text-light);">Давайте швидко пройдемось по основних можливостях! 🚀</p></div>'
    },
    {
      icon: '📦',
      title: 'Матеріали та продукція',
      subtitle: 'Крок 1 з 4',
      body: '<div class="onb-feature"><div class="onb-feature-icon">📦</div><div class="onb-feature-text"><h4>База матеріалів</h4><p>Додайте всі ваші матеріали: ліпучки, папір, плівку та інші витратники. Вказуйте ціни та постачальників — система слідкуватиме за залишками.</p></div></div><div class="onb-feature"><div class="onb-feature-icon">🎮</div><div class="onb-feature-text"><h4>Каталог ігор</h4><p>Створіть свої ігри (продукцію). Для кожної гри можна скласти «Склад виробу» — технологічну карту з матеріалами.</p></div></div><div class="onb-feature"><div class="onb-feature-icon">📥</div><div class="onb-feature-text"><h4>Імпорт з Excel</h4><p>Вже маєте базу? Завантажте CSV-файл у налаштуваннях — і всі матеріали або ігри будуть імпортовані за секунди.</p></div></div>'
    },
    {
      icon: '📊',
      title: 'Собівартість та фінанси',
      subtitle: 'Крок 2 з 4',
      body: '<div class="onb-feature"><div class="onb-feature-icon">🧮</div><div class="onb-feature-text"><h4>Автоматична калькуляція</h4><p>Собівартість розраховується автоматично: матеріали + друк + пакування + шаблон + робота майстра. Бачите маржу по кожній грі.</p></div></div><div class="onb-feature"><div class="onb-feature-icon">🖨</div><div class="onb-feature-text"><h4>Облік друку та чорнил</h4><p>Налаштуйте принтер (4-8 кольорів), ведіть журнал заправок, відстежуйте витратники — вартість друку додається в собівартість.</p></div></div><div class="onb-feature"><div class="onb-feature-icon">💰</div><div class="onb-feature-text"><h4>Зарплата майстра</h4><p>Встановіть ставку — відсоток від ціни або фіксована сума за кожну гру. Автоматичний розрахунок ЗП по виробництву.</p></div></div>'
    },
    {
      icon: '📋',
      title: 'Замовлення та виробництво',
      subtitle: 'Крок 3 з 4',
      body: '<div class="onb-feature"><div class="onb-feature-icon">📝</div><div class="onb-feature-text"><h4>Управління замовленнями</h4><p>Ведіть замовлення з автоматичною нумерацією, статусами та відстеженням дедлайнів. Бачите які матеріали потрібні.</p></div></div><div class="onb-feature"><div class="onb-feature-icon">🔧</div><div class="onb-feature-text"><h4>Контроль виробництва</h4><p>Запускайте виробництво ігор, відмічайте готові — система автоматично списує матеріали та рахує склад.</p></div></div><div class="onb-feature"><div class="onb-feature-icon">👷</div><div class="onb-feature-text"><h4>Видача майстрам</h4><p>Передавайте готову продукцію майстрам для продажу — бачите хто скільки має на руках.</p></div></div>'
    },
    {
      icon: '🤝',
      title: 'Команда та налаштування',
      subtitle: 'Крок 4 з 4',
      body: '<div class="onb-feature"><div class="onb-feature-icon">👥</div><div class="onb-feature-text"><h4>Підключення майстрів</h4><p>Запросіть майстрів за email — вони отримають свій доступ з обмеженими правами (що бачити, а що ні).</p></div></div><div class="onb-feature"><div class="onb-feature-icon">⚙️</div><div class="onb-feature-text"><h4>Гнучкі налаштування</h4><p>Налаштуйте принтер, ставку майстра, інтеграцію з SalesDrive CRM, імпорт даних з Excel.</p></div></div><div class="onb-feature"><div class="onb-feature-icon">🎬</div><div class="onb-feature-text"><h4>Відео-інструкції</h4><p>Незабаром на YouTube — детальний огляд всіх можливостей системи. Підпишіться, щоб не пропустити!</p></div></div>'
    }
  ];
  
  window._onbStep = 0;
  
  function showOnboarding() {
    window._onbStep = 0;
    renderOnbStep();
    document.getElementById('onboarding-overlay').classList.add('show');
  }
  
  function renderOnbStep() {
    var step = window.onbSteps[window._onbStep];
    var total = window.onbSteps.length;
    document.getElementById('onb-icon').textContent = step.icon;
    document.getElementById('onb-title').textContent = step.title;
    document.getElementById('onb-subtitle').textContent = step.subtitle;
    document.getElementById('onb-body').innerHTML = step.body;
  
    // Dots
    var dotsHtml = '';
    for (var i = 0; i < total; i++) {
      dotsHtml += '<div class="onb-dot' + (i === window._onbStep ? ' active' : '') + '"></div>';
    }
    document.getElementById('onb-dots').innerHTML = dotsHtml;
  
    // Buttons
    document.getElementById('onb-back').style.display = window._onbStep === 0 ? 'none' : '';
    var nextBtn = document.getElementById('onb-next');
    if (window._onbStep === total - 1) {
      nextBtn.textContent = 'Почати роботу! 🚀';
      nextBtn.onclick = closeOnboarding;
    } else {
      nextBtn.textContent = 'Далі →';
      nextBtn.onclick = function() { window._onbStep++; renderOnbStep(); };
    }
  }
  
  function closeOnboarding() {
    document.getElementById('onboarding-overlay').classList.remove('show');
    localStorage.setItem('lipo_onboarding_done', '1');
    // Clean URL
    window.history.replaceState({}, '', '/app');
    // Show feature wizard after onboarding tour
    if (!localStorage.getItem('lipo_features_configured')) {
      setTimeout(showFeatureWizard, 400);
    }
  }
  
  // Check if should show onboarding
  (function() {
    var params = new URLSearchParams(window.location.search);
    var isNewUser = params.get('welcome') === '1';
    var onbDone = localStorage.getItem('lipo_onboarding_done');
    if (isNewUser && !onbDone) {
      setTimeout(showOnboarding, 800);
    } else if (onbDone && !localStorage.getItem('lipo_features_configured')) {
      // User completed onboarding tour but never picked features
      setTimeout(showFeatureWizard, 800);
    }
  })();
  
  // Also trigger onboarding from email registration response
  window._origRegistrationFetch = null;

  window.showOnboarding = showOnboarding;
  window.renderOnbStep = renderOnbStep;
  window.closeOnboarding = closeOnboarding;
})();
