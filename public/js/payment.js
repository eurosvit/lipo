// ============================================================
// LipoLand — Payment module (WayForPay integration)
// ============================================================
// Підписка з апсейлом за майстрів. window._selectedPlan на window.

(function(){
  'use strict';

  // ==================== PAYMENT ====================
  window._selectedPlan = null;
  
  function openPaymentModal() {
    window._selectedPlan = null;
    document.getElementById('pay-btn').disabled = true;
    document.getElementById('pay-btn').textContent = 'Оплатити';
    document.getElementById('payment-error').style.display = 'none';
    document.querySelectorAll('.payment-plan-card').forEach(function(c) {
      c.style.borderColor = c.querySelector('input[value="month6"]') ? 'var(--primary)' : 'var(--border)';
      c.style.background = '#fff';
      c.querySelector('input').checked = false;
    });
    document.getElementById('account-panel').classList.remove('show');
    // Update prices dynamically based on connected workers
    updatePaymentPrices();
    openModal('payment');
  }
  
  function updatePaymentPrices() {
    var wc = (_currentUser && _currentUser.connectedWorkersCount) || 0;
    var surcharge1 = wc * 100;  // per month
    var surcharge6 = wc * 100 * 6;
    var surcharge12 = wc * 100 * 12;
  
    var base1 = 250, base6 = 1250, base12 = 2200;
    var total1 = base1 + surcharge1;
    var total6 = base6 + surcharge6;
    var total12 = base12 + surcharge12;
    var perMonth6 = Math.round(total6 / 6);
    var perMonth12 = Math.round(total12 / 12);
  
    // Worker surcharge banner
    var bannerEl = document.getElementById('worker-surcharge-banner');
    if (bannerEl) {
      if (wc > 0) {
        bannerEl.innerHTML = '👩‍🔧 Підключено майстрів: <b>' + wc + '</b> — +' + (wc * 100) + ' грн/міс до вартості';
        bannerEl.style.display = 'block';
      } else {
        bannerEl.style.display = 'none';
      }
    }
  
    // Update card prices
    var cards = document.querySelectorAll('.payment-plan-card');
    cards.forEach(function(card) {
      var input = card.querySelector('input[name="plan"]');
      if (!input) return;
      var val = input.value;
      if (val === 'month1') {
        card.querySelector('.pp-price').textContent = total1;
        card.querySelector('.pp-detail').innerHTML = wc > 0
          ? 'Базова: 250 грн<br>+' + surcharge1 + ' грн за ' + wc + ' майстр.'
          : 'Щомісячна оплата<br>Без зобов\'язань';
      } else if (val === 'month6') {
        card.querySelector('.pp-price').textContent = perMonth6;
        var save6 = Math.round((1 - total6 / (total1 * 6)) * 100);
        card.querySelector('.pp-save').textContent = 'Економія ' + save6 + '%';
        card.querySelector('.pp-detail').innerHTML = 'Разом: <strong style="color:var(--text);">' + total6.toLocaleString('uk-UA') + ' грн</strong><br><s style="color:#ccc;">' + (total1 * 6).toLocaleString('uk-UA') + ' грн</s>';
      } else if (val === 'month12') {
        card.querySelector('.pp-price').textContent = perMonth12;
        var save12 = Math.round((1 - total12 / (total1 * 12)) * 100);
        card.querySelector('.pp-save').textContent = 'Економія ' + save12 + '%';
        card.querySelector('.pp-detail').innerHTML = 'Разом: <strong style="color:var(--text);">' + total12.toLocaleString('uk-UA') + ' грн</strong><br><s style="color:#ccc;">' + (total1 * 12).toLocaleString('uk-UA') + ' грн</s>';
      }
    });
  
    // Store totals for selectPlan button text
    window._planTotals = {
      month1: total1, month6: total6, month12: total12
    };
  }
  
  function selectPlan(el, plan) {
    window._selectedPlan = plan;
    var btn = document.getElementById('pay-btn');
    btn.disabled = false;
    var totals = window._planTotals || { month1: 250, month6: 1250, month12: 2200 };
    btn.textContent = totals[plan].toLocaleString('uk-UA') + ' грн — Оплатити';
    document.querySelectorAll('.payment-plan-card').forEach(function(c) {
      var isPopular = !!c.querySelector('input[value="month6"]');
      c.style.borderColor = 'var(--border)';
      c.style.background = '#fff';
      c.style.transform = isPopular ? 'scale(1.04)' : '';
      c.style.boxShadow = isPopular ? '0 8px 30px rgba(123,31,162,0.15)' : '';
    });
    el.style.borderColor = 'var(--primary)';
    el.style.background = '#FDFAFF';
    el.style.transform = 'scale(1.04)';
    el.style.boxShadow = '0 8px 30px rgba(123,31,162,0.2)';
  }
  
  function initPayment() {
    if (!window._selectedPlan) return;
    var btn = document.getElementById('pay-btn');
    btn.disabled = true;
    btn.textContent = 'Створюємо оплату...';
    var errEl = document.getElementById('payment-error');
    errEl.style.display = 'none';
  
    fetch('/api/payment/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ plan: window._selectedPlan })
    }).then(function(r) { return r.json(); }).then(function(data) {
      if (data.error) {
        errEl.textContent = data.error;
        errEl.style.display = 'block';
        btn.disabled = false;
        btn.textContent = 'Оплатити';
        return;
      }
      // Submit to WayForPay
      submitToWayForPay(data);
    }).catch(function(e) {
      errEl.textContent = 'Помилка з\'єднання з сервером';
      errEl.style.display = 'block';
      btn.disabled = false;
      btn.textContent = 'Оплатити';
    });
  }
  
  function submitToWayForPay(paymentData) {
    // Create hidden form and submit to WayForPay
    var form = document.createElement('form');
    form.method = 'POST';
    form.action = 'https://secure.wayforpay.com/pay';
    form.acceptCharset = 'utf-8';
  
    var fields = {
      merchantAccount: paymentData.merchantAccount,
      merchantDomainName: paymentData.merchantDomainName,
      merchantSignature: paymentData.merchantSignature,
      orderReference: paymentData.orderReference,
      orderDate: paymentData.orderDate,
      amount: paymentData.amount,
      currency: paymentData.currency,
      'productName[]': paymentData.productName[0],
      'productCount[]': paymentData.productCount[0],
      'productPrice[]': paymentData.productPrice[0],
      returnUrl: paymentData.returnUrl,
      serviceUrl: paymentData.serviceUrl
    };
  
    Object.keys(fields).forEach(function(key) {
      var input = document.createElement('input');
      input.type = 'hidden';
      input.name = key;
      input.value = fields[key];
      form.appendChild(input);
    });
  
    document.body.appendChild(form);
    form.submit();
  }
  
  // Check if returned from payment
  (function() {
    var params = new URLSearchParams(window.location.search);
    if (params.get('payment') === 'success') {
      setTimeout(function() {
        alert('✅ Дякуємо за оплату!\n\nВаша підписка LipoLand PRO активована. Приємного користування!');
        window.history.replaceState({}, '', '/app');
        loadAccount();
      }, 500);
    } else if (params.get('payment') === 'failed') {
      setTimeout(function() {
        alert('❌ Оплата не пройшла.\n\nСпробуйте ще раз або зверніться до підтримки.');
        window.history.replaceState({}, '', '/app');
      }, 500);
    }
  })();

  window.openPaymentModal = openPaymentModal;
  window.updatePaymentPrices = updatePaymentPrices;
  window.selectPlan = selectPlan;
  window.initPayment = initPayment;
  window.submitToWayForPay = submitToWayForPay;
})();
