// ============================================================
// LipoLand — utils (shared helpers)
// ============================================================
// esc, fmt, uid, v, n, matAtWorkers, matTotalQty.
// Експортуються одразу на window щоб і defer-модулі, і inline-script,
// і onclick-обробники могли користуватись через простий global identifier
// (esc, fmt, uid у браузерному global scope = window.esc).
//
// УВАГА: цей файл має завантажуватись ПЕРШИМ defer-скриптом —
// інші модулі (audit/clients/salary/etc) залежать від його експортів.

(function(){
  'use strict';

  // Random ID (для items, batches, тощо)
  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2,7);
  }

  // Прочитати input value за id
  function v(id) {
    var el = document.getElementById(id);
    return el ? el.value : '';
  }

  // Прочитати numeric input value за id (NaN → 0)
  function n(id) {
    var el = document.getElementById(id);
    return el ? (parseFloat(el.value)||0) : 0;
  }

  // Форматувати число: 1234.500 → 1234.5; 1234.00 → 1234
  function fmt(num) {
    return Number(num).toFixed(2).replace(/\.00$/,'').replace(/(\.\d)0$/,'$1');
  }

  // Безпечне escape для вставки в innerHTML
  function esc(s) {
    if (!s && s !== 0) return '';
    var d = document.createElement('div');
    d.appendChild(document.createTextNode(s));
    return d.innerHTML;
  }

  // Сума матеріалу за всіма складами майстрів (для total qty / low-stock)
  function matAtWorkers(db, matId) {
    return ((db && db.workerStock) || []).reduce(function(s, ws){
      return s + ((ws.type==='material' && ws.itemId===matId) ? (ws.qty||0) : 0);
    }, 0);
  }

  // Загальна кількість матеріалу: на головному + всі склади майстрів
  function matTotalQty(db, m) {
    return (m.qty||0) + matAtWorkers(db, m.id);
  }

  // Нормалізує телефон в міжнародний формат E.164 (+380XXXXXXXXX)
  // Приймає: +380681234567, 0681234567, 380681234567, 38 (068) 123-45-67 — все одно.
  function normPhoneIntl(phone) {
    if (!phone) return '';
    var digits = String(phone).replace(/\D/g, '');
    if (!digits) return '';
    if (digits.startsWith('380')) return '+' + digits;
    if (digits.startsWith('80') && digits.length === 11) return '+3' + digits;
    if (digits.startsWith('0') && digits.length === 10) return '+38' + digits;
    // Невпізнаний формат — повертаємо як є з + спереду
    return '+' + digits;
  }

  // Будує блок іконок для зв'язку: tel + Telegram + Viber + WhatsApp + копіювати.
  // `compact` = true: маленькі іконки під ім'ям клієнта. false: повний з номером.
  function buildContactIcons(phone, compact) {
    if (!phone) return '';
    var p = String(phone);
    var pIntl = normPhoneIntl(p);
    var pClean = pIntl.replace('+', '');           // for wa.me
    var pNoPlus = pIntl;                            // for viber://
    var sz = compact ? '14px' : '16px';
    var gap = compact ? '4px' : '6px';
    var btnStyle = 'text-decoration:none;font-size:'+sz+';opacity:0.85;cursor:pointer;display:inline-block;';
    var phoneDisplay = compact
      ? '<a href="tel:'+esc(pIntl)+'" style="font-size:11px;color:var(--text-light);text-decoration:none;margin-right:6px;">'+esc(p)+'</a>'
      : '<a href="tel:'+esc(pIntl)+'" style="font-size:12px;color:var(--primary);text-decoration:none;margin-right:8px;">📞 '+esc(p)+'</a>';
    return '<span style="white-space:nowrap;display:inline-flex;align-items:center;gap:'+gap+';">'+
      phoneDisplay +
      '<a href="https://t.me/'+esc(pNoPlus)+'" target="_blank" rel="noopener" title="Telegram" style="'+btnStyle+'">✈️</a>' +
      '<a href="viber://chat?number='+esc(pNoPlus)+'" title="Viber" style="'+btnStyle+'">💬</a>' +
      '<a href="https://wa.me/'+esc(pClean)+'" target="_blank" rel="noopener" title="WhatsApp" style="'+btnStyle+'">📱</a>' +
      '<button onclick="event.preventDefault();event.stopPropagation();navigator.clipboard&&navigator.clipboard.writeText(\''+esc(pIntl)+'\').then(function(){this.textContent=\'✅\';}.bind(this));" title="Скопіювати номер" style="background:none;border:none;cursor:pointer;font-size:'+sz+';opacity:0.85;padding:0;">📋</button>' +
    '</span>';
  }

  // Експортуємо ВСЕ як window — інакше defer-модулі і inline-script не побачать
  window.uid = uid;
  window.v = v;
  window.n = n;
  window.fmt = fmt;
  window.esc = esc;
  window.matAtWorkers = matAtWorkers;
  window.matTotalQty = matTotalQty;
  window.normPhoneIntl = normPhoneIntl;
  window.buildContactIcons = buildContactIcons;
})();
