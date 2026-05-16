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

  // Експортуємо ВСЕ як window — інакше defer-модулі і inline-script не побачать
  window.uid = uid;
  window.v = v;
  window.n = n;
  window.fmt = fmt;
  window.esc = esc;
  window.matAtWorkers = matAtWorkers;
  window.matTotalQty = matTotalQty;
})();
