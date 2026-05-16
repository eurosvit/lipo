// ============================================================
// LipoLand — Custom Tooltip module
// ============================================================
// Замінює браузерні title-tooltip на кастомні бульки що з'являються миттєво.
// Працює для БУДЬ-якого елемента з [title] — без зміни існуючого HTML.
// На touch-only devices не активується (там немає hover).

(function(){
  'use strict';

  // Skip on touch-only devices (no hover support)
  var isTouchOnly = ('ontouchstart' in window) && !window.matchMedia('(hover: hover)').matches;
  if (isTouchOnly) return;

  var tip = document.createElement('div');
  tip.id = 'lipo-tooltip';
  tip.style.cssText = [
    'position:fixed',
    'display:none',
    'background:#2d2d2d',
    'color:#fff',
    'padding:7px 11px',
    'border-radius:8px',
    'font-size:12px',
    'font-weight:500',
    'line-height:1.4',
    'pointer-events:none',
    'z-index:99999',
    'max-width:260px',
    'box-shadow:0 4px 14px rgba(0,0,0,0.25)',
    'opacity:0',
    'transform:translateY(-4px)',
    'transition:opacity 0.12s ease-out, transform 0.12s ease-out',
    'white-space:pre-wrap',
    'word-break:break-word'
  ].join(';');

  // Стрілка вгорі (CSS pseudo через before — створимо через окремий div)
  var arrow = document.createElement('div');
  arrow.style.cssText = [
    'position:absolute',
    'width:0',
    'height:0',
    'border-left:6px solid transparent',
    'border-right:6px solid transparent',
    'border-bottom:6px solid #2d2d2d',
    'top:-6px',
    'left:50%',
    'margin-left:-6px'
  ].join(';');
  tip.appendChild(arrow);
  document.body.appendChild(tip);

  var currentTarget = null;
  var arrowPos = 'top'; // tip position relative to target

  function show(el) {
    var t = el.getAttribute('title');
    if (!t) return;
    // Зберігаємо оригінальний title, прибираємо щоб браузер не показав свій
    el.setAttribute('data-tip-title', t);
    el.removeAttribute('title');

    // Скидаємо текст і додаємо arrow знову (innerHTML очищає)
    while (tip.childNodes.length > 1) tip.removeChild(tip.lastChild);
    tip.appendChild(document.createTextNode(t));
    tip.appendChild(arrow);

    tip.style.display = 'block';
    positionTip(el);
    // Затримка для анімації появи
    requestAnimationFrame(function(){
      tip.style.opacity = '1';
      tip.style.transform = 'translateY(0)';
    });
    currentTarget = el;
  }

  function hide() {
    if (!currentTarget) return;
    var orig = currentTarget.getAttribute('data-tip-title');
    if (orig) {
      currentTarget.setAttribute('title', orig);
      currentTarget.removeAttribute('data-tip-title');
    }
    tip.style.opacity = '0';
    tip.style.transform = 'translateY(-4px)';
    setTimeout(function(){ if (tip.style.opacity === '0') tip.style.display = 'none'; }, 130);
    currentTarget = null;
  }

  function positionTip(el) {
    var rect = el.getBoundingClientRect();
    var tipW = tip.offsetWidth;
    var tipH = tip.offsetHeight;
    var pad = 8;
    // За замовч. — знизу елемента
    var top = rect.bottom + pad;
    var left = rect.left + rect.width / 2 - tipW / 2;

    // Якщо не вміщається знизу — показуємо зверху
    var below = true;
    if (top + tipH > window.innerHeight - pad) {
      top = rect.top - tipH - pad;
      below = false;
    }
    // Boundary clamp по горизонталі
    if (left < pad) left = pad;
    if (left + tipW > window.innerWidth - pad) left = window.innerWidth - tipW - pad;

    tip.style.top = Math.max(pad, top) + 'px';
    tip.style.left = left + 'px';

    // Перерозташувати стрілку: знизу tip коли висимо вище target, зверху коли нижче
    if (below) {
      arrow.style.top = '-6px';
      arrow.style.bottom = '';
      arrow.style.borderTop = '';
      arrow.style.borderBottom = '6px solid #2d2d2d';
    } else {
      arrow.style.top = '';
      arrow.style.bottom = '-6px';
      arrow.style.borderBottom = '';
      arrow.style.borderTop = '6px solid #2d2d2d';
    }
    // Стрілку — над центром target (з урахуванням clamp tip)
    var arrowLeft = (rect.left + rect.width / 2) - left;
    arrowLeft = Math.max(8, Math.min(arrowLeft, tipW - 8));
    arrow.style.left = arrowLeft + 'px';
    arrow.style.marginLeft = '-6px';
  }

  // Delegation: одне-разове прив'язання на document
  document.addEventListener('mouseover', function(e){
    var el = e.target.closest('[title]');
    if (!el) return;
    // Не реагуємо на elements без content title (порожні)
    if (!el.getAttribute('title')) return;
    show(el);
  }, true);

  document.addEventListener('mouseout', function(e){
    if (!currentTarget) return;
    // Перевіряємо що target дійсно покидається (а не перейшли на child)
    var rel = e.relatedTarget;
    if (rel && currentTarget.contains(rel)) return;
    hide();
  }, true);

  // Якщо клікнули — приховати tooltip миттєво (зайвий тут)
  document.addEventListener('click', function(){
    if (currentTarget) hide();
  }, true);

  // Якщо вікно скрол / resize — приховати
  window.addEventListener('scroll', hide, true);
  window.addEventListener('resize', hide);
})();
