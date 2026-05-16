// ============================================================
// LipoLand — Inventory Audit module
// ============================================================
// Інвентаризація — звірка факт vs система. Корекції одразу застосовуються
// до p.stock / mat.qty. Записи зберігаються в db.inventoryAudits[].

(function(){
  'use strict';

  var _invState = null;

  function openInventoryModal(type) {
    var db = getDB();
    if (type === 'material') {
      document.getElementById('inv-title').textContent = '📋 Інвентаризація матеріалів';
      _invState = {
        type: 'material',
        items: (db.materials || []).map(function(m){
          return { id: m.id, name: m.name + (m.size?' ('+m.size+')':''), unit: m.unit || 'шт', systemQty: Number(m.qty)||0, factQty: '', reason: '' };
        })
      };
    } else {
      document.getElementById('inv-title').textContent = '📋 Інвентаризація готових ігор';
      _invState = {
        type: 'product',
        items: (db.products || []).filter(function(p){return p.active !== false;}).map(function(p){
          return { id: p.id, name: (p.sku?p.sku+' — ':'') + p.name + (p.size?' ('+p.size+')':''), unit: 'шт', systemQty: Number(p.stock)||0, factQty: '', reason: '' };
        })
      };
    }
    // Експортуємо _invState на window щоб inline oninput="_invState.items[idx].factQty=..." працювало
    window._invState = _invState;
    document.getElementById('inv-search').value = '';
    document.getElementById('inv-show-only-checked').checked = false;
    document.getElementById('inv-note').value = '';
    renderInventoryRows();
    openModal('inventory');
  }

  function renderInventoryRows() {
    if (!_invState) return;
    var search = (document.getElementById('inv-search').value||'').toLowerCase().trim();
    var onlyChecked = document.getElementById('inv-show-only-checked').checked;
    var filtered = _invState.items.filter(function(it){
      if (search && it.name.toLowerCase().indexOf(search) === -1) return false;
      if (onlyChecked && (it.factQty === '' || it.factQty === null || it.factQty === undefined)) return false;
      return true;
    });
    var html = filtered.map(function(it, idx){
      var realIdx = _invState.items.indexOf(it);
      var fact = it.factQty;
      var hasValue = fact !== '' && fact !== null && fact !== undefined && !isNaN(parseFloat(fact));
      var diff = hasValue ? (parseFloat(fact) - it.systemQty) : null;
      var diffColor = diff === null ? 'var(--text-light)' : (diff === 0 ? 'var(--success)' : (diff > 0 ? '#1565C0' : 'var(--danger)'));
      var diffStr = diff === null ? '—' : (diff > 0 ? '+'+fmt(diff) : fmt(diff));
      var diffBg = diff !== null && diff !== 0 ? (diff > 0 ? '#E3F2FD' : '#FFEBEE') : '';
      return '<tr style="border-bottom:1px solid #f0f0f0;'+(diffBg?'background:'+diffBg+';':'')+'">'+
        '<td style="padding:6px 8px;">'+esc(it.name)+'</td>'+
        '<td style="padding:6px 8px;text-align:center;font-size:12px;color:var(--text-light);">'+esc(it.unit)+'</td>'+
        '<td style="padding:6px 8px;text-align:right;font-weight:600;">'+fmt(it.systemQty)+'</td>'+
        '<td style="padding:6px 8px;text-align:center;">'+
          '<input type="number" step="0.01" min="0" value="'+(fact===''?'':esc(String(fact)))+'" '+
          'oninput="_invState.items['+realIdx+'].factQty=this.value;renderInventoryRows()" '+
          'style="width:90px;padding:4px 6px;text-align:right;font-size:13px;border:1px solid var(--border);border-radius:4px;"></td>'+
        '<td style="padding:6px 8px;text-align:right;font-weight:700;color:'+diffColor+';">'+diffStr+'</td>'+
        '<td style="padding:6px 8px;">'+
          '<input type="text" value="'+esc(it.reason||'')+'" '+
          'oninput="_invState.items['+realIdx+'].reason=this.value" '+
          'placeholder="напр.: брак, втрата" '+
          'style="width:100%;padding:4px 6px;font-size:12px;border:1px solid var(--border);border-radius:4px;'+(diff!==null && diff !== 0?'':'opacity:0.5;')+'"></td>'+
      '</tr>';
    }).join('') || '<tr><td colspan="6" class="text-muted" style="text-align:center;padding:20px;">'+(search||onlyChecked?'Нема за фільтром':'Список порожній')+'</td></tr>';
    document.getElementById('inv-rows').innerHTML = html;

    var checked = _invState.items.filter(function(it){
      var v = it.factQty;
      return v !== '' && v !== null && v !== undefined && !isNaN(parseFloat(v));
    });
    var withDiff = checked.filter(function(it){ return parseFloat(it.factQty) !== it.systemQty; });
    document.getElementById('inv-summary').textContent =
      'Перевірено: ' + checked.length + ' з ' + _invState.items.length +
      (withDiff.length ? ' • з різницями: ' + withDiff.length : '');
  }

  function commitInventory() {
    if (!_invState) return;
    var db = getDB();
    var changed = _invState.items.filter(function(it){
      var v = it.factQty;
      if (v === '' || v === null || v === undefined || isNaN(parseFloat(v))) return false;
      return parseFloat(v) !== it.systemQty;
    });
    var checkedCount = _invState.items.filter(function(it){
      var v = it.factQty;
      return v !== '' && v !== null && v !== undefined && !isNaN(parseFloat(v));
    }).length;

    if (checkedCount === 0) {
      alert('Не заповнено жодної кількості. Заповни хоча б одну позицію.');
      return;
    }
    if (changed.length === 0) {
      alert('Усе сходиться (різниць нема). Інвентаризація завершена — нічого змінювати не треба.');
      closeModal('inventory');
      return;
    }
    var msg = 'Зафіксувати інвентаризацію?\n\nПеревірено: '+checkedCount+' позицій\nЗ різницями: '+changed.length+'\n\n' +
      changed.slice(0, 10).map(function(it){
        var diff = parseFloat(it.factQty) - it.systemQty;
        return '• ' + it.name + ': ' + fmt(it.systemQty) + ' → ' + fmt(it.factQty) + ' ('+(diff>0?'+':'')+fmt(diff)+')';
      }).join('\n') +
      (changed.length > 10 ? '\n... і ще ' + (changed.length - 10) : '') +
      '\n\nКорекції одразу застосуються до складу.';
    if (!confirm(msg)) return;

    var today = new Date().toISOString().slice(0,10);
    var noteAll = document.getElementById('inv-note').value.trim();
    if (!db.inventoryAudits) db.inventoryAudits = [];
    var auditId = uid();
    var savedType = _invState.type; // зберігаємо ДО reset

    var appliedItems = [];
    changed.forEach(function(it){
      var newQty = parseFloat(it.factQty);
      var diff = newQty - it.systemQty;
      if (savedType === 'material') {
        var m = db.materials.find(function(x){return x.id === it.id;});
        if (m) m.qty = newQty;
      } else {
        var p = db.products.find(function(x){return x.id === it.id;});
        if (p) p.stock = newQty;
      }
      appliedItems.push({
        id: it.id, name: it.name, unit: it.unit,
        systemQty: it.systemQty, factQty: newQty, diff: diff,
        reason: it.reason || ''
      });
    });

    db.inventoryAudits.push({
      id: auditId, date: today, type: savedType,
      items: appliedItems, checkedCount: checkedCount,
      user: (window._currentUser && (window._currentUser.linkedWorkerName || window._currentUser.name)) || 'Невідомо',
      note: noteAll
    });

    if (typeof logAudit === 'function') {
      logAudit(db, 'material', auditId, 'adjust', {
        inventoryAudit: true,
        type: savedType,
        itemsAdjusted: appliedItems.length,
        checked: checkedCount,
        note: noteAll
      });
    }

    saveDB(db);
    closeModal('inventory');
    _invState = null;
    window._invState = null;
    alert('✓ Інвентаризацію зафіксовано. Виправлено '+changed.length+' позицій.');
    // Bug fix: оригінал перевіряв _invState ПІСЛЯ reset → завжди false. Тепер savedType.
    if (savedType === 'material') renderPage('materials');
    else renderPage('products');
  }

  window.openInventoryModal = openInventoryModal;
  window.renderInventoryRows = renderInventoryRows;
  window.commitInventory = commitInventory;
})();
