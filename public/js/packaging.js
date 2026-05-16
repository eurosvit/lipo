// ============================================================
// LipoLand — Packaging Kits module
// ============================================================
// Менеджер комплектів пакування (коробка + плівка + ...).
// Створення, редагування, видалення, селекти в товарах.

(function(){
  'use strict';

  // ==================== PACKAGING KITS ====================
  function addPkgComponent(containerId) {
    var container = document.getElementById(containerId);
    var db = getDB();
    var packMats = db.materials.filter(function(m){ return m.category === 'packaging'; });
    var div = document.createElement('div');
    div.className = 'form-row';
    var selectHtml = '<option value="">— Вручну —</option>' +
      packMats.map(function(m){ return '<option value="'+esc(m.name)+'" data-price="'+m.price+'">'+esc(m.name)+' ('+fmt(m.price)+' грн)</option>'; }).join('');
    div.innerHTML = '<div class="form-group" style="flex:2;"><label>Компонент</label>'+
      '<select class="pkg-comp-select" onchange="pkgCompSelected(this,\''+containerId+'\')" style="margin-bottom:6px;">'+selectHtml+'</select>'+
      '<input class="pkg-comp-name" placeholder="Або введіть вручну"></div>'+
      '<div class="form-group"><label>Ціна, грн</label><input class="pkg-comp-price" type="number" step="0.01" value="0" oninput="recalcPkgTotal(\''+containerId+'\')"></div>'+
      '<button class="btn btn-danger btn-sm" onclick="this.parentElement.remove();recalcPkgTotal(\''+containerId+'\')" style="margin-bottom:2px;">✕</button>';
    container.appendChild(div);
  }
  
  function pkgCompSelected(sel, containerId) {
    var row = sel.closest('.form-row');
    var nameInput = row.querySelector('.pkg-comp-name');
    var priceInput = row.querySelector('.pkg-comp-price');
    if (sel.value) {
      nameInput.value = sel.value;
      var opt = sel.options[sel.selectedIndex];
      var price = parseFloat(opt.getAttribute('data-price')) || 0;
      priceInput.value = price;
      nameInput.style.display = 'none';
    } else {
      nameInput.value = '';
      nameInput.style.display = '';
      nameInput.focus();
    }
    recalcPkgTotal(containerId);
  }
  
  function recalcPkgTotal(containerId) {
    var container = document.getElementById(containerId);
    var total = 0;
    container.querySelectorAll('.pkg-comp-price').forEach(function(inp) {
      total += parseFloat(inp.value) || 0;
    });
    var prefix = containerId === 'pkg-components' ? 'pkg' : 'epkg';
    var el = document.getElementById(prefix + '-total-cost');
    if (el) el.textContent = fmt(total);
  }
  
  function getPkgComponents(containerId) {
    var container = document.getElementById(containerId);
    var rows = container.querySelectorAll('.form-row');
    var comps = [];
    rows.forEach(function(r) {
      var sel = r.querySelector('.pkg-comp-select');
      var name = (sel && sel.value) ? sel.value : r.querySelector('.pkg-comp-name').value.trim();
      var price = parseFloat(r.querySelector('.pkg-comp-price').value) || 0;
      if (name) comps.push({ name: name, price: price });
    });
    return comps;
  }
  
  function savePackagingKit() {
    var name = document.getElementById('pkg-name').value.trim();
    if (!name) return alert('Введіть назву комплекту');
    var components = getPkgComponents('pkg-components');
    if (components.length === 0) return alert('Додайте хоча б один компонент');
    var total = 0;
    components.forEach(function(c) { total += c.price; });
    var db = getDB();
    if (!db.packagingKits) db.packagingKits = [];
    db.packagingKits.push({ id: uid(), name: name, components: components, totalCost: Math.round(total * 100) / 100 });
    saveDB(db);
    closeModal('add-packaging');
    document.getElementById('pkg-name').value = '';
    document.getElementById('pkg-components').innerHTML = '';
    document.getElementById('pkg-total-cost').textContent = '0.00';
    renderPage('materials');
  }
  
  function editPackagingKit(id) {
    var db = getDB();
    var kit = (db.packagingKits || []).find(function(k) { return k.id === id; });
    if (!kit) return;
    document.getElementById('epkg-id').value = id;
    document.getElementById('epkg-name').value = kit.name;
    var container = document.getElementById('epkg-components');
    container.innerHTML = '';
    (kit.components || []).forEach(function(c) {
      addPkgComponent('epkg-components');
      var last = container.lastElementChild;
      last.querySelector('.pkg-comp-name').value = c.name;
      last.querySelector('.pkg-comp-price').value = c.price;
    });
    recalcPkgTotal('epkg-components');
    openModal('edit-packaging');
  }
  
  function updatePackagingKit() {
    var id = document.getElementById('epkg-id').value;
    var name = document.getElementById('epkg-name').value.trim();
    if (!name) return alert('Введіть назву комплекту');
    var components = getPkgComponents('epkg-components');
    if (components.length === 0) return alert('Додайте хоча б один компонент');
    var total = 0;
    components.forEach(function(c) { total += c.price; });
    var db = getDB();
    var kit = (db.packagingKits || []).find(function(k) { return k.id === id; });
    if (!kit) return;
    kit.name = name;
    kit.components = components;
    kit.totalCost = Math.round(total * 100) / 100;
    saveDB(db);
    closeModal('edit-packaging');
    renderPage('materials');
  }
  
  function deletePackagingKit(id) {
    if (!confirm('Видалити комплект пакування?')) return;
    var db = getDB();
    db.packagingKits = (db.packagingKits || []).filter(function(k) { return k.id !== id; });
    // Clear kit reference from products that use it
    db.products.forEach(function(p) {
      if (p.packagingKitId === id) {
        p.packagingKitId = null;
        p.packagingCost = 0;
      }
    });
    saveDB(db);
    renderPage('materials');
  }
  
  function renderPackagingKits() {
    var db = getDB();
    var tb = document.getElementById('packaging-kits-table');
    if (!tb) return;
    var kits = db.packagingKits || [];
    tb.innerHTML = kits.map(function(k) {
      var compsStr = (k.components || []).map(function(c) { return esc(c.name) + ' (' + fmt(c.price) + ' грн)'; }).join(' + ');
      return '<tr>' +
        '<td data-label="Назва"><strong>' + esc(k.name) + '</strong></td>' +
        '<td data-label="Компоненти"><span style="font-size:13px;">' + compsStr + '</span></td>' +
        '<td data-label="Вартість"><strong>' + fmt(k.totalCost) + ' грн</strong></td>' +
        '<td data-label="Дії"><button class="btn btn-outline btn-sm" onclick="editPackagingKit(\'' + k.id + '\')">✏️</button> <button class="btn btn-danger btn-sm" onclick="deletePackagingKit(\'' + k.id + '\')">🗑</button></td>' +
      '</tr>';
    }).join('') || '<tr><td colspan="4" class="text-muted" style="text-align:center;padding:24px;">Додайте перший комплект пакування</td></tr>';
  }
  
  function populatePackagingKitSelects() {
    var db = getDB();
    var kits = db.packagingKits || [];
    var opts = '<option value="">— Без пакування —</option>' + kits.map(function(k) {
      return '<option value="' + k.id + '">' + esc(k.name) + ' (' + fmt(k.totalCost) + ' грн)</option>';
    }).join('');
    var el1 = document.getElementById('prod-packaging-kit');
    var el2 = document.getElementById('eprod-packaging-kit');
    if (el1) el1.innerHTML = opts;
    if (el2) el2.innerHTML = opts;
  }
  
  function updatePackagingPreview(prefix) {
    var kitId = v(prefix + '-packaging-kit');
    var db = getDB();
    var kit = (db.packagingKits || []).find(function(k) { return k.id === kitId; });
    var cost = kit ? kit.totalCost : 0;
    var el = document.getElementById(prefix + '-packaging');
    if (el) el.value = fmt(cost) + ' грн';
  }
  
  function getSelectedPackagingCost(prefix) {
    var kitId = v(prefix + '-packaging-kit');
    var db = getDB();
    var kit = (db.packagingKits || []).find(function(k) { return k.id === kitId; });
    return kit ? kit.totalCost : 0;
  }

  window.addPkgComponent = addPkgComponent;
  window.pkgCompSelected = pkgCompSelected;
  window.recalcPkgTotal = recalcPkgTotal;
  window.getPkgComponents = getPkgComponents;
  window.savePackagingKit = savePackagingKit;
  window.editPackagingKit = editPackagingKit;
  window.updatePackagingKit = updatePackagingKit;
  window.deletePackagingKit = deletePackagingKit;
  window.renderPackagingKits = renderPackagingKits;
  window.populatePackagingKitSelects = populatePackagingKitSelects;
  window.updatePackagingPreview = updatePackagingPreview;
  window.getSelectedPackagingCost = getSelectedPackagingCost;
})();
