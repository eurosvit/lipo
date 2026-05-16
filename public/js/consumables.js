// ============================================================
// LipoLand — Consumables + default worker rate module
// ============================================================
// Витратники (запчастини, спецодяг) + дефолтна ставка майстра.

(function(){
  'use strict';

  // ==================== CONSUMABLES ====================
  function addConsumable() {
    var db = getDB();
    if (!db.consumables) db.consumables = [];
    var item = {
      id: uid(),
      date: v('cons-date') || new Date().toISOString().slice(0,10),
      type: v('cons-type'),
      cost: n('cons-cost')
    };
    if (item.cost <= 0) return alert('Вкажіть вартість');
    db.consumables.push(item);
    saveDB(db);
    renderConsumables(db);
  }
  
  function deleteConsumable(id) {
    var db = getDB();
    db.consumables = (db.consumables||[]).filter(function(c){ return c.id !== id; });
    saveDB(db);
    renderConsumables(db);
  }
  
  function renderConsumables(db) {
    var list = document.getElementById('consumables-list');
    if (!list) return;
    var items = (db.consumables||[]).slice().reverse();
    var totalCost = items.reduce(function(s,c){ return s + (c.cost||0); }, 0);
  
    if (items.length === 0) {
      list.innerHTML = '<p class="text-muted" style="font-size:13px;">Немає записів</p>';
      return;
    }
  
    var typeEmoji = { 'Памперс принтера':'🧽', 'Ніж Камео':'🔪', 'Килимок Камео':'📋', 'Лезо різака':'✂️', 'Інше':'🔧' };
    list.innerHTML = '<div style="font-size:13px;font-weight:600;margin-bottom:6px;">Витрачено на розходники: <span class="text-danger">' + fmt(totalCost) + ' грн</span></div>' +
      '<div style="max-height:150px;overflow-y:auto;">' +
      items.slice(0,15).map(function(c) {
        return '<div style="display:flex;align-items:center;gap:8px;padding:4px 0;font-size:12px;border-bottom:1px solid rgba(0,0,0,0.04);">' +
          '<span style="min-width:80px;">' + c.date + '</span>' +
          '<span>' + (typeEmoji[c.type]||'🔧') + ' ' + esc(c.type) + '</span>' +
          '<span style="margin-left:auto;font-weight:600;">' + fmt(c.cost) + ' грн</span>' +
          '<button class="btn btn-danger btn-sm" style="padding:1px 6px;font-size:10px;" onclick="deleteConsumable(\'' + c.id + '\')">✕</button>' +
        '</div>';
      }).join('') +
      '</div>';
  }
  
  function saveDefaultRate() {
    var db = getDB();
    db.workerRateDefault = {
      type: v('default-rate-type'),
      value: parseFloat(v('default-rate-value'))||25
    };
    saveDB(db);
    alert('Ставку за замовчуванням збережено!');
  }

  window.addConsumable = addConsumable;
  window.deleteConsumable = deleteConsumable;
  window.renderConsumables = renderConsumables;
  window.saveDefaultRate = saveDefaultRate;
})();
