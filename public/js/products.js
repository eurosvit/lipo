// ============================================================
// LipoLand — Products module (найбільший!)
// ============================================================
// Каталог ігор: CRUD, recipe-builder, категорії, колонки таблиці,
// розрахунок собівартості (calcCost) і can-produce (calcCanProduce).
// Викликається з багатьох інших модулів — calcCost/calcCanProduce.

(function(){
  'use strict';

  // ==================== PRODUCTS ====================
  function refreshRecipeOptions(container) {
    // Disable options already used in OTHER rows (keep current row's own selection enabled).
    var rows = container.querySelectorAll('.form-row');
    var selects = Array.prototype.map.call(rows, function(r){ return r.querySelector('.recipe-mat'); }).filter(Boolean);
    var usedIds = selects.map(function(s){ return s.value; });
    selects.forEach(function(sel, idx){
      Array.prototype.forEach.call(sel.options, function(opt){
        var takenElsewhere = usedIds.some(function(id, i){ return i!==idx && id===opt.value; });
        opt.disabled = takenElsewhere;
      });
    });
  }
  
  function addRecipeLine(containerId) {
    var db = getDB();
    var container = document.getElementById(containerId || 'prod-recipe');
    // Block if all materials are already used (manual + click flow only — programmatic edit pre-fills rows directly)
    var rows = container.querySelectorAll('.form-row');
    var usedIds = Array.prototype.map.call(rows, function(r){ var s = r.querySelector('.recipe-mat'); return s ? s.value : null; }).filter(Boolean);
    var firstUnused = (db.materials || []).find(function(m){ return usedIds.indexOf(m.id) === -1; });
    if (!firstUnused) { alert('Усі матеріали вже додано в рецепт. Видали зайвий рядок або додай новий матеріал у каталог.'); return; }
    var allOpts = db.materials.slice().sort(function(a,b){return (a.name||'').localeCompare(b.name||'','uk')});
    var div = document.createElement('div');
    div.className = 'form-row';
    div.style.alignItems = 'center';
    div.innerHTML =
      '<div class="form-group"><label>Матеріал</label><select class="recipe-mat" onchange="refreshRecipeOptions(this.closest(\'#'+container.id+'\'))">'+allOpts.map(function(m){return '<option value="'+m.id+'">'+esc(m.name)+'</option>';}).join('')+'</select></div>'+
      '<div class="form-group"><label>Кількість на 1 шт</label><input class="recipe-qty" type="number" step="0.01" value="1"></div>'+
      '<button class="btn btn-danger btn-sm" onclick="var c=this.closest(\'#'+container.id+'\');this.parentElement.remove();refreshRecipeOptions(c);" style="margin-bottom:2px;">&#x2715;</button>';
    container.appendChild(div);
    // Auto-select the first material that isn't already used
    div.querySelector('.recipe-mat').value = firstUnused.id;
    refreshRecipeOptions(container);
  }
  
  function getRecipeFromContainer(containerId) {
    var container = document.getElementById(containerId || 'prod-recipe');
    var rows = container.querySelectorAll('.form-row');
    var recipe = [];
    var seen = {};
    rows.forEach(function(r) {
      var matId = r.querySelector('.recipe-mat').value;
      var qty = parseFloat(r.querySelector('.recipe-qty').value)||0;
      if(!matId || qty<=0) return;
      if (seen[matId]) { seen[matId].qty += qty; return; }  // safety: merge duplicates
      var entry = { materialId:matId, qty:qty };
      seen[matId] = entry;
      recipe.push(entry);
    });
    return recipe;
  }
  
  function saveProduct() {
    var db = getDB();
    var p = { id:uid(), sku:v('prod-sku'), name:v('prod-name'), size:v('prod-size'), category:v('prod-category'),
      pages:parseInt(v('prod-pages'))||0, pagesA5:parseInt(v('prod-pages-a5'))||0,
      sellPrice:n('prod-price'), workerRate:n('prod-rate'),
      workerRateType: v('prod-rate-type'), packagingKitId: v('prod-packaging-kit'), packagingCost: getSelectedPackagingCost('prod'),
      templateCost: n('prod-template-cost'), templateQty: parseInt(v('prod-template-qty'))||0,
      templateCovered: parseInt(v('prod-template-covered'))||0,
      recipe:getRecipeFromContainer('prod-recipe'), stock:0, inProgress:0, active:true };
    if(!p.name) return alert('Введіть назву');
    db.products.push(p);
    saveDB(db);
    closeModal('add-product');
    document.getElementById('prod-name').value='';
    document.getElementById('prod-sku').value='';
    renderPage('products');
  }
  
  function editProduct(id) {
    var db = getDB();
    var p = db.products.find(function(x){return x.id===id});
    if(!p) return;
    document.getElementById('eprod-id').value = id;
    document.getElementById('eprod-sku').value = p.sku||'';
    document.getElementById('eprod-name').value = p.name;
    document.getElementById('eprod-size').value = p.size||'';
    populateCategorySelects();
    document.getElementById('eprod-category').value = p.category||'';
    document.getElementById('eprod-pages').value = p.pages||0;
    var eA5 = document.getElementById('eprod-pages-a5'); if (eA5) eA5.value = p.pagesA5||0;
    document.getElementById('eprod-price').value = p.sellPrice;
    document.getElementById('eprod-rate-type').value = p.workerRateType || (db.workerRateDefault||{}).type || 'percent';
    document.getElementById('eprod-rate').value = p.workerRate || (db.workerRateDefault||{}).value || 25;
    populatePackagingKitSelects();
    document.getElementById('eprod-packaging-kit').value = p.packagingKitId || '';
    updatePackagingPreview('eprod');
    document.getElementById('eprod-template-cost').value = p.templateCost || 0;
    document.getElementById('eprod-template-qty').value = p.templateQty || 0;
    var eCov = document.getElementById('eprod-template-covered');
    if (eCov) eCov.value = p.templateCovered || 0;
    var rc = document.getElementById('eprod-recipe');
    rc.innerHTML = '';
    (p.recipe||[]).forEach(function(r) {
      addRecipeLine('eprod-recipe');
      var last = rc.lastElementChild;
      if (last) {
        last.querySelector('.recipe-mat').value = r.materialId;
        last.querySelector('.recipe-qty').value = r.qty;
      }
    });
    refreshRecipeOptions(rc);
    openModal('edit-product');
    updateRatePreview('eprod');
    updatePrintPreview('eprod');
    updateTemplatePreview('eprod');
  }
  
  function updateProduct() {
    var db = getDB();
    var id = document.getElementById('eprod-id').value;
    var p = db.products.find(function(x){return x.id===id});
    if(!p) return;
    p.sku = v('eprod-sku'); p.name = v('eprod-name'); p.size = v('eprod-size');
    p.category = v('eprod-category'); p.pages = parseInt(v('eprod-pages'))||0;
    p.pagesA5 = parseInt(v('eprod-pages-a5'))||0;
    p.sellPrice = n('eprod-price'); p.workerRate = n('eprod-rate');
    p.workerRateType = v('eprod-rate-type'); p.packagingKitId = v('eprod-packaging-kit'); p.packagingCost = getSelectedPackagingCost('eprod');
    p.templateCost = n('eprod-template-cost'); p.templateQty = parseInt(v('eprod-template-qty'))||0;
    p.templateCovered = parseInt(v('eprod-template-covered'))||0;
    p.recipe = getRecipeFromContainer('eprod-recipe');
    saveDB(db);
    closeModal('edit-product');
    renderPage('products');
  }
  
  function updateRatePreview(prefix) {
    var type = v(prefix+'-rate-type');
    var val = n(prefix+'-rate');
    var price = n(prefix+'-price');
    var result = 0;
    if (type === 'percent') {
      result = Math.round(price * val / 100);
    } else {
      result = val;
    }
    var el = document.getElementById(prefix+'-rate-preview');
    if (el) el.value = fmt(result) + ' грн';
  }
  
  function updatePrintPreview(prefix) {
    var pagesA4 = parseInt(v(prefix+'-pages'))||0;
    var pagesA5 = parseInt(v(prefix+'-pages-a5'))||0;
    var db = getDB();
    var costPerPage = (db.printerSettings||{}).costPerPageA4 || 0;
    var el = document.getElementById(prefix+'-print-cost-preview');
    if (!el) return;
    var totalPages = pagesA4 + pagesA5;
    if (totalPages === 0) { el.value = 'Без друку'; return; }
    if (costPerPage <= 0) { el.value = 'Вкажіть вартість друку в Налаштуваннях'; return; }
    var costA4 = pagesA4 * costPerPage;
    var costA5 = pagesA5 * costPerPage * 0.5;
    var total = costA4 + costA5;
    var parts = [];
    if (pagesA4 > 0) parts.push(pagesA4+' А4');
    if (pagesA5 > 0) parts.push(pagesA5+' А5');
    el.value = fmt(total) + ' грн (' + parts.join(' + ') + ')';
  }
  
  function updateTemplatePreview(prefix) {
    var cost = n(prefix+'-template-cost');
    var qty = parseInt(v(prefix+'-template-qty'))||0;
    var covered = parseInt(v(prefix+'-template-covered'))||0;
    var box = document.getElementById(prefix+'-template-status');
    if (!box) return;
    if (cost <= 0 || qty <= 0) {
      box.innerHTML = '<div style="font-size:12px;color:var(--text-light);padding:8px 10px;background:#fff;border-radius:6px;">Шаблон не використовується</div>';
      return;
    }
    covered = Math.min(Math.max(0, covered), qty);
    var perUnit = Math.round(cost / qty * 100) / 100;
    var pct = Math.round(covered / qty * 100);
    var remaining = qty - covered;
    var statusHtml, barColor;
    if (remaining <= 0) {
      statusHtml = '<strong style="color:#2E7D32;">✅ Шаблон окуплений!</strong> Додає <strong>0 грн</strong> до собівартості.';
      barColor = '#2E7D32';
    } else {
      statusHtml = '<strong>+'+fmt(perUnit)+' грн</strong> до кожної з наступних <strong>'+remaining+' шт</strong>. Після цього — 0 грн.';
      barColor = '#7B1FA2';
    }
    box.innerHTML =
      '<div style="background:#fff;padding:10px 12px;border-radius:8px;">'+
        '<div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:6px;">'+
          '<span>Окуплено: <strong>'+covered+'/'+qty+' шт</strong></span>'+
          '<span style="color:'+barColor+';"><strong>'+pct+'%</strong></span>'+
        '</div>'+
        '<div class="progress-bar" style="background:#F3E5F5;"><div class="progress-fill" style="width:'+pct+'%;background:'+barColor+';"></div></div>'+
        '<div style="font-size:12px;margin-top:8px;">'+statusHtml+'</div>'+
      '</div>';
  }
  
  var _saProductId = null;
  function openStockAdjust(id) {
    var db = getDB();
    var p = db.products.find(function(x){return x.id===id});
    if(!p) return;
    _saProductId = id;
    document.getElementById('sa-product-name').textContent = (p.sku ? p.sku+' — ' : '') + p.name;
    // Populate warehouse selector
    var locs = db.fulfillmentLocations || ['Розетка'];
    var whSel = document.getElementById('sa-warehouse');
    whSel.innerHTML = '<option value="main">📦 Мій склад</option>' + locs.map(function(l){ return '<option value="ff:'+esc(l)+'">🏬 '+esc(l)+'</option>'; }).join('');
    whSel.value = 'main';
    document.getElementById('sa-current-stock').textContent = 'Мій склад: ' + (p.stock||0) + ' шт';
    document.getElementById('sa-type').value = 'add';
    document.getElementById('sa-qty').value = 1;
    document.getElementById('sa-reason').value = '';
    updateSaPreview();
    openModal('stock-adjust');
  }
  function _saGetCurrentStock(p) {
    var wh = v('sa-warehouse');
    if (wh === 'main') return p.stock || 0;
    var loc = wh.substring(3);
    return (p.fulfillment && p.fulfillment[loc]) || 0;
  }
  function updateSaPreview() {
    var db = getDB();
    var p = db.products.find(function(x){return x.id===_saProductId});
    if(!p) return;
    var type = v('sa-type');
    var qty = parseInt(v('sa-qty'))||0;
    var cur = _saGetCurrentStock(p);
    var wh = v('sa-warehouse');
    var whLabel = wh === 'main' ? 'Мій склад' : wh.substring(3);
    document.getElementById('sa-current-stock').textContent = whLabel + ': ' + cur + ' шт';
    var result;
    if(type==='add') result = cur + qty;
    else if(type==='set') result = qty;
    else result = Math.max(0, cur - qty);
    var el = document.getElementById('sa-preview');
    el.innerHTML = '📊 Було: <strong>'+cur+'</strong> → Стане: <strong style="color:var(--primary);">'+result+'</strong> шт';
  }
  function applyStockAdjust() {
    var db = getDB();
    var p = db.products.find(function(x){return x.id===_saProductId});
    if(!p) return;
    var type = v('sa-type');
    var qty = parseInt(v('sa-qty'))||0;
    var reason = v('sa-reason').trim() || 'Ручне коригування';
    var wh = v('sa-warehouse');
    if(qty < 0) { alert('Кількість не може бути від\'ємною'); return; }
    var newStock;
    if (wh === 'main') {
      var oldStock = p.stock||0;
      if(type==='add') p.stock = oldStock + qty;
      else if(type==='set') p.stock = qty;
      else p.stock = Math.max(0, oldStock - qty);
      newStock = p.stock;
    } else {
      var loc = wh.substring(3);
      if (!p.fulfillment) p.fulfillment = {};
      var oldStock = p.fulfillment[loc] || 0;
      if(type==='add') p.fulfillment[loc] = oldStock + qty;
      else if(type==='set') p.fulfillment[loc] = qty;
      else p.fulfillment[loc] = Math.max(0, oldStock - qty);
      newStock = p.fulfillment[loc];
    }
    saveDB(db);
    closeModal('stock-adjust');
    renderProducts();
    var whLabel = wh === 'main' ? '' : ' ('+wh.substring(3)+')';
    alert('✅ Склад'+whLabel+' «'+p.name+'»: '+oldStock+' → '+newStock+' шт ('+reason+')');
  }
  
  function duplicateProduct(id) {
    var db = getDB();
    var orig = db.products.find(function(x){ return x.id === id; });
    if (!orig) return;
    var newSku = (orig.sku || '') + '_copy';
    // якщо існує — додаємо число
    var n = 2;
    while (db.products.some(function(p){ return p.sku === newSku; })) {
      newSku = (orig.sku || '') + '_copy' + n;
      n++;
    }
    var copy = JSON.parse(JSON.stringify(orig));
    copy.id = uid();
    copy.sku = newSku;
    copy.name = (orig.name || 'Товар') + ' (копія)';
    copy.stock = 0;
    copy.inProgress = 0;
    copy.fulfillment = {};
    // recipe копіюється як є
    db.products.push(copy);
    saveDB(db);
    renderPage('products');
    // одразу відкриваємо для редагування
    setTimeout(function(){ editProduct(copy.id); }, 100);
  }
  
  function deleteProduct(id) {
    if(!confirm('Видалити цю гру?')) return;
    var db = getDB();
    db.products = db.products.filter(function(x){return x.id!==id});
    saveDB(db);
    renderPage('products');
  }
  
  function toggleProduct(id, activate) {
    var db = getDB();
    var p = db.products.find(function(x){return x.id===id});
    if(!p) return;
    p.active = activate;
    saveDB(db);
    renderProducts();
  }
  
  // Effective per-unit consumption for a material in a recipe (з урахуванням браку)
  function effectiveRecipeQty(mat, baseQty) {
    var w = mat && mat.wastePercent ? Math.max(0, Math.min(100, mat.wastePercent)) : 0;
    return baseQty * (1 + w/100);
  }
  // Total need for N units, rounded up (бо не можна списати 0.5 аркуша)
  function effectiveNeed(mat, baseQty, units) {
    var raw = effectiveRecipeQty(mat, baseQty) * units;
    return mat && mat.wastePercent > 0 ? Math.ceil(raw) : raw;
  }
  
  function calcCanProduce(product, materials) {
    if(!product.recipe || product.recipe.length===0) return 0;
    var min = Infinity;
    for(var i=0;i<product.recipe.length;i++) {
      var r = product.recipe[i];
      var mat = materials.find(function(m){return m.id===r.materialId});
      if(!mat || r.qty<=0) return 0;
      var perUnit = effectiveRecipeQty(mat, r.qty);
      if (perUnit <= 0) return 0;
      min = Math.min(min, Math.floor((mat.qty||0) / perUnit));
    }
    return min===Infinity?0:min;
  }
  
  function calcCost(product, materials, db) {
    if (!db) db = getDB();
    var matCost = 0;
    var recipe = product.recipe||[];
    for(var i=0;i<recipe.length;i++) {
      var r = recipe[i];
      var mat = materials.find(function(m){return m.id===r.materialId});
      if(mat) matCost += effectiveRecipeQty(mat, r.qty) * mat.price;
    }
    // Print cost (A4 + A5 at half-cost)
    var printCost = 0;
    var ps = db.printerSettings || {};
    if ((ps.costPerPageA4||0) > 0) {
      printCost = (product.pages||0) * ps.costPerPageA4;
      printCost += (product.pagesA5||0) * ps.costPerPageA4 * 0.5;
    }
    // Packaging — use kit price if available (always up-to-date)
    var packagingCost = 0;
    if (product.packagingKitId) {
      var pkgKit = (db.packagingKits || []).find(function(k) { return k.id === product.packagingKitId; });
      packagingCost = pkgKit ? pkgKit.totalCost : (product.packagingCost || 0);
    } else {
      packagingCost = product.packagingCost || 0;
    }
    // Template amortization — fast payback on the first N units
    // Once templateCovered >= templateQty, the template is paid off and adds 0 to cost
    var templateCost = 0;
    if ((product.templateCost||0) > 0 && (product.templateQty||0) > 0) {
      var covered = product.templateCovered || 0;
      if (covered < product.templateQty) {
        templateCost = Math.round(product.templateCost / product.templateQty * 100) / 100;
      }
    }
    // Worker rate
    var work = 0;
    var rateType = product.workerRateType || (db.workerRateDefault || {}).type || 'percent';
    var rateValue = product.workerRate || 0;
    if (rateValue === 0 && db.workerRateDefault) rateValue = db.workerRateDefault.value || 25;
    if (rateType === 'percent') {
      work = Math.round((product.sellPrice||0) * rateValue / 100);
    } else {
      work = rateValue;
    }
    var total = matCost + printCost + packagingCost + templateCost + work;
    return { materials: matCost, print: printCost, packaging: packagingCost, template: templateCost, work: work, total: total, rateType: rateType, rateValue: rateValue };
  }
  
  function getCategories(db) {
    var cats = {};
    (db.categories||[]).forEach(function(c){ cats[c]=true; });
    db.products.forEach(function(p){ if(p.category) cats[p.category]=true; });
    var all = Object.keys(cats);
    // Якщо є явний порядок — використовуємо його; нові додаються в кінець (алфавіт)
    var order = db.categoryOrder || [];
    if (order.length) {
      var ordered = order.filter(function(c){ return cats[c]; });
      var rest = all.filter(function(c){ return order.indexOf(c) === -1; }).sort();
      return ordered.concat(rest);
    }
    return all.sort();
  }
  
  function renderCatManager() {
    var db = getDB();
    var cats = getCategories(db);
    var list = document.getElementById('cat-list');
    if (!list) return;
    list.innerHTML = cats.map(function(c){
      var escaped = c.replace(/'/g,"\\'");
      return '<span draggable="true" data-cat="'+esc(c)+'" '+
          'ondragstart="catDragStart(event,\''+esc(escaped)+'\')" '+
          'ondragover="catDragOver(event,\''+esc(escaped)+'\')" '+
          'ondragleave="catDragLeave(event)" '+
          'ondrop="catDrop(event,\''+esc(escaped)+'\')" '+
          'ondragend="catDragEnd(event)" '+
          'style="display:inline-flex;align-items:center;gap:4px;padding:4px 10px;background:#fff;border:1px solid var(--border);border-radius:16px;font-size:13px;cursor:grab;transition:background .15s,border-color .15s;">' +
        '<span style="color:#999;font-size:11px;user-select:none;">≡</span>' +
        esc(c) +
        '<button onclick="renameCategory(\''+esc(escaped)+'\')" style="background:none;border:none;cursor:pointer;font-size:11px;padding:0 2px;" title="Перейменувати">✏️</button>' +
        '<button onclick="deleteCategory(\''+esc(escaped)+'\')" style="background:none;border:none;cursor:pointer;font-size:11px;padding:0 2px;color:#F44336;" title="Видалити">✕</button>' +
      '</span>';
    }).join(' ') || '<span class="text-muted" style="font-size:13px;">Немає категорій</span>';
  }
  
  // Drag&drop категорій — винесено в public/js/drag-drop.js
  
  
  function addCategory() {
    var name = document.getElementById('new-cat-name').value.trim();
    if (!name) return;
    var db = getDB();
    if (!db.categories) db.categories = [];
    if (db.categories.indexOf(name) === -1) db.categories.push(name);
    saveDB(db);
    document.getElementById('new-cat-name').value = '';
    renderProducts();
  }
  
  function renameCategory(oldName) {
    var newName = prompt('Нова назва для "' + oldName + '":', oldName);
    if (!newName || newName.trim() === oldName) return;
    newName = newName.trim();
    var db = getDB();
    if (!db.categories) db.categories = [];
    var idx = db.categories.indexOf(oldName);
    if (idx !== -1) db.categories[idx] = newName;
    else db.categories.push(newName);
    // Update all products with old category
    db.products.forEach(function(p){ if(p.category === oldName) p.category = newName; });
    saveDB(db);
    renderProducts();
  }
  
  function deleteCategory(name) {
    if (!confirm('Видалити категорію "' + name + '"? Товари залишаться без категорії.')) return;
    var db = getDB();
    db.categories = (db.categories||[]).filter(function(c){ return c !== name; });
    db.products.forEach(function(p){ if(p.category === name) p.category = ''; });
    saveDB(db);
    renderProducts();
  }
  
  function populateCategorySelects() {
    var db = getDB();
    var cats = getCategories(db);
    var opts = '<option value="">— Оберіть —</option>' + cats.map(function(c){ return '<option value="'+esc(c)+'">'+esc(c)+'</option>'; }).join('');
    var add = document.getElementById('prod-category');
    var edit = document.getElementById('eprod-category');
    if (add) { var sv = add.value; add.innerHTML = opts; add.value = sv; }
    if (edit) { var sv2 = edit.value; edit.innerHTML = opts; edit.value = sv2; }
  }
  
  var _prodSort = { key: null, asc: true };
  
  var _defaultProdCols = [
    { id:'sku', label:'Артикул', sortable:true, visible:true },
    { id:'name', label:'Назва', sortable:true, visible:true },
    { id:'size', label:'Розмір', sortable:false, visible:true },
    { id:'category', label:'Категорія', sortable:false, visible:true },
    { id:'stock', label:'Мій склад', sortable:true, visible:true },
    { id:'fulfillment', label:'На фулфілменті', sortable:true, visible:true },
    { id:'atWorker', label:'У майстрів', sortable:true, visible:true },
    { id:'inProgress', label:'В роботі', sortable:true, visible:true },
    { id:'cost', label:'Собівартість', sortable:true, visible:true },
    { id:'sellPrice', label:'Ціна продажу', sortable:true, visible:true },
    { id:'margin', label:'Маржа', sortable:true, visible:true },
    { id:'canProduce', label:'Можна зібрати', sortable:true, visible:true }
  ];
  
  function getProdCols() {
    try {
      var saved = JSON.parse(localStorage.getItem('lipo_prod_cols'));
      if (saved && saved.length) {
        // Merge with defaults (add new cols that might not be in saved)
        var savedIds = saved.map(function(c){return c.id;});
        _defaultProdCols.forEach(function(d) {
          if (savedIds.indexOf(d.id)===-1) saved.push({id:d.id,label:d.label,sortable:d.sortable,visible:true});
        });
        // Update labels/sortable from defaults
        return saved.map(function(s) {
          var def = _defaultProdCols.find(function(d){return d.id===s.id;});
          return def ? {id:s.id, label:def.label, sortable:def.sortable, visible:s.visible} : s;
        }).filter(function(s) {
          return _defaultProdCols.some(function(d){return d.id===s.id;});
        });
      }
    } catch(e){}
    return _defaultProdCols.map(function(c){return {id:c.id,label:c.label,sortable:c.sortable,visible:c.visible};});
  }
  
  function saveProdCols(cols) {
    localStorage.setItem('lipo_prod_cols', JSON.stringify(cols));
  }
  
  var _prodColsDraft = null;
  
  function toggleProdColSettings() {
    var el = document.getElementById('prod-col-settings');
    el.style.display = el.style.display==='none' ? 'block' : 'none';
    if (el.style.display==='block') {
      _prodColsDraft = getProdCols();
      renderProdColSettings();
    }
  }
  
  function renderProdColSettings() {
    var cols = _prodColsDraft || getProdCols();
    var html = '';
    cols.forEach(function(c, i) {
      html += '<div style="display:flex;align-items:center;gap:8px;padding:6px 8px;background:#fff;border:1px solid var(--border);border-radius:8px;margin-bottom:4px;" data-col-id="'+c.id+'">'+
        '<input type="checkbox" '+(c.visible?'checked':'')+' onchange="toggleProdCol(\''+c.id+'\',this.checked)" style="width:16px;height:16px;accent-color:var(--primary);">'+
        '<span style="flex:1;font-size:13px;font-weight:500;">'+c.label+'</span>'+
        '<button onclick="moveProdCol(\''+c.id+'\',-1)" style="background:none;border:none;cursor:pointer;font-size:14px;padding:2px 4px;opacity:'+(i===0?'0.2':'0.7')+';" '+(i===0?'disabled':'')+'>▲</button>'+
        '<button onclick="moveProdCol(\''+c.id+'\',1)" style="background:none;border:none;cursor:pointer;font-size:14px;padding:2px 4px;opacity:'+(i===cols.length-1?'0.2':'0.7')+';" '+(i===cols.length-1?'disabled':'')+'>▼</button>'+
      '</div>';
    });
    document.getElementById('prod-col-list').innerHTML = html;
  }
  
  function toggleProdCol(colId, visible) {
    if (!_prodColsDraft) _prodColsDraft = getProdCols();
    var col = _prodColsDraft.find(function(c){return c.id===colId;});
    if (col) col.visible = visible;
    renderProdColSettings();
  }
  
  function moveProdCol(colId, dir) {
    if (!_prodColsDraft) _prodColsDraft = getProdCols();
    var idx = _prodColsDraft.findIndex(function(c){return c.id===colId;});
    if (idx===-1) return;
    var newIdx = idx + dir;
    if (newIdx < 0 || newIdx >= _prodColsDraft.length) return;
    var tmp = _prodColsDraft[idx];
    _prodColsDraft[idx] = _prodColsDraft[newIdx];
    _prodColsDraft[newIdx] = tmp;
    renderProdColSettings();
  }
  
  function saveProdColSettings() {
    if (_prodColsDraft) saveProdCols(_prodColsDraft);
    _prodColsDraft = null;
    document.getElementById('prod-col-settings').style.display = 'none';
    renderProducts();
  }
  
  function resetProdCols() {
    localStorage.removeItem('lipo_prod_cols');
    _prodColsDraft = getProdCols();
    renderProdColSettings();
  }
  
  function sortProducts(key) {
    if (_prodSort.key === key) {
      _prodSort.asc = !_prodSort.asc;
    } else {
      _prodSort.key = key;
      _prodSort.asc = true;
    }
    renderProducts();
  }
  
  function updateSortIcons() {
    document.querySelectorAll('th.sortable').forEach(function(th) {
      th.classList.remove('asc', 'desc');
    });
    if (_prodSort.key) {
      var th = document.querySelector('th.sortable[onclick*="\''+_prodSort.key+'\'"]');
      if (th) th.classList.add(_prodSort.asc ? 'asc' : 'desc');
    }
  }
  
  // Палітра для секцій-категорій у Складі (матчиться зі стилем матеріалів)
  var _prodCategoryPalette = [
    '#E3F2FD;border-left:4px solid #1976D2',
    '#FCE4EC;border-left:4px solid #E91E63',
    '#FFF3E0;border-left:4px solid #E65100',
    '#E8F5E9;border-left:4px solid #2E7D32',
    '#F3E5F5;border-left:4px solid #7B1FA2',
    '#FFF8E1;border-left:4px solid #F9A825',
    '#E0F2F1;border-left:4px solid #00796B',
    '#FFEBEE;border-left:4px solid #C62828',
    '#EDE7F6;border-left:4px solid #5E35B1',
    '#F1F8E9;border-left:4px solid #558B2F'
  ];
  function _prodCategoryColor(cat) {
    if (!cat) return '#FAFAFA;border-left:4px solid #BDBDBD';
    var h = 0;
    for (var i = 0; i < cat.length; i++) h = ((h<<5) - h + cat.charCodeAt(i)) | 0;
    return _prodCategoryPalette[Math.abs(h) % _prodCategoryPalette.length];
  }
  
  function renderProducts() {
    var db = getDB();
    var search = (document.getElementById('prod-search').value||'').toLowerCase().trim();
    var catFilter = document.getElementById('prod-cat-filter').value;
  
    // Populate category filter (preserve selection)
    var cats = getCategories(db);
    var catSel = document.getElementById('prod-cat-filter');
    var opts = '<option value="">Всі категорії</option>';
    cats.forEach(function(c){ opts += '<option value="'+esc(c)+'" '+(c===catFilter?'selected':'')+'>'+esc(c)+'</option>'; });
    catSel.innerHTML = opts;
    renderCatManager();
    populateCategorySelects();
  
    var statusFilter = document.getElementById('prod-status-filter').value;
  
    var filtered = db.products.filter(function(p) {
      if(statusFilter==='active' && p.active===false) return false;
      if(statusFilter==='inactive' && p.active!==false) return false;
      if(catFilter && p.category!==catFilter) return false;
      if(search) {
        var haystack = ((p.sku||'')+' '+p.name+' '+(p.category||'')).toLowerCase();
        if(haystack.indexOf(search)===-1) return false;
      }
      return true;
    });
  
    document.getElementById('prod-count').textContent = 'Показано: '+filtered.length+' з '+db.products.length;
  
    // Precompute products at workers
    var _atWorker = {};
    (db.workerStock || []).forEach(function(s) {
      if (s.type === 'product') {
        _atWorker[s.itemId] = (_atWorker[s.itemId] || 0) + s.qty;
      }
    });
  
    // Column config
    var cols = getProdCols();
    var visCols = cols.filter(function(c){return c.visible;});
  
    // Sort
    if (_prodSort.key) {
      filtered.sort(function(a, b) {
        var va, vb;
        switch(_prodSort.key) {
          case 'sku': va = (a.sku||'').toLowerCase(); vb = (b.sku||'').toLowerCase(); break;
          case 'name': va = (a.name||'').toLowerCase(); vb = (b.name||'').toLowerCase(); break;
          case 'stock': va = a.stock||0; vb = b.stock||0; break;
          case 'atWorker': va = _atWorker[a.id]||0; vb = _atWorker[b.id]||0; break;
          case 'inProgress': va = a.inProgress||0; vb = b.inProgress||0; break;
          case 'cost': va = calcCost(a, db.materials, db).total; vb = calcCost(b, db.materials, db).total; break;
          case 'sellPrice': va = a.sellPrice||0; vb = b.sellPrice||0; break;
          case 'margin': va = (a.sellPrice||0) - calcCost(a, db.materials, db).total; vb = (b.sellPrice||0) - calcCost(b, db.materials, db).total; break;
          case 'canProduce': va = calcCanProduce(a, db.materials); vb = calcCanProduce(b, db.materials); break;
          case 'fulfillment':
            var ffa = a.fulfillment||{}, ffb = b.fulfillment||{};
            va = Object.keys(ffa).reduce(function(s,k){return s+(ffa[k]||0);},0);
            vb = Object.keys(ffb).reduce(function(s,k){return s+(ffb[k]||0);},0);
            break;
          default: va = 0; vb = 0;
        }
        if (typeof va === 'string') {
          var cmp = va.localeCompare(vb, 'uk');
          return _prodSort.asc ? cmp : -cmp;
        }
        return _prodSort.asc ? va - vb : vb - va;
      });
    }
  
    // Render thead
    var thead = document.getElementById('products-thead');
    thead.innerHTML = '<th style="width:36px;"><input type="checkbox" id="prod-select-all" onchange="toggleAllProducts(this.checked)" style="width:18px;height:18px;accent-color:var(--primary);"></th>' +
      visCols.map(function(c) {
        if (c.sortable) return '<th class="sortable" onclick="sortProducts(\''+c.id+'\')">'+c.label+'</th>';
        return '<th>'+c.label+'</th>';
      }).join('') + '<th>Дії</th>';
    updateSortIcons();
  
    // Cell renderer
    function cellHtml(colId, p, cost, can, margin, marginPct, atW, inactive) {
      switch(colId) {
        case 'sku': return '<td data-label="Артикул"><code>'+esc(p.sku||'—')+'</code></td>';
        case 'name':
          var noRecipe = !p.recipe || p.recipe.length === 0;
          var recipeWarn = noRecipe ? '<span title="Рецепт не заповнено — додай матеріали (клікни щоб відкрити редагування)" onclick="event.stopPropagation();editProduct(\''+p.id+'\')" style="display:inline-block;color:#E65100;margin-right:6px;cursor:pointer;font-size:14px;line-height:1;" role="button">📋⚠️</span>' : '';
          return '<td data-label="Назва">'+recipeWarn+'<strong>'+esc(p.name)+'</strong>'+(inactive?' <span class="badge badge-warning" style="font-size:10px;">пауза</span>':'')+'</td>';
        case 'size': return '<td data-label="Розмір">'+esc(p.size||'—')+'</td>';
        case 'category': return '<td data-label="Категорія"><span class="badge badge-ok">'+esc(p.category||'—')+'</span></td>';
        case 'stock': return '<td data-label="Мій склад">'+(p.stock||0)+'</td>';
        case 'fulfillment':
          var ff = p.fulfillment || {};
          var ffTotal = Object.keys(ff).reduce(function(s,k){ return s + (ff[k]||0); }, 0);
          var ffParts = Object.keys(ff).filter(function(k){return ff[k]>0}).map(function(k){ return esc(k)+': '+ff[k]; });
          return '<td data-label="На фулфілменті">'+(ffTotal > 0 ? '<span style="color:#7B1FA2;font-weight:600;" title="'+esc(ffParts.join(', '))+'">'+ffTotal+'</span>' : '0')+'</td>';
        case 'atWorker': return '<td data-label="У майстрів">'+(atW > 0 ? '<span style="color:var(--primary);font-weight:600;">'+atW+'</span>' : '0')+'</td>';
        case 'inProgress': return '<td data-label="В роботі">'+(p.inProgress||0)+'</td>';
        case 'cost': return '<td data-label="Собівартість">'+fmt(cost.total)+' грн</td>';
        case 'sellPrice': return '<td data-label="Ціна продажу" style="cursor:pointer;" onclick="inlineEditProductPrice(this,\''+p.id+'\','+(p.sellPrice||0)+')" title="Клікни щоб змінити ціну продажу"><span style="color:var(--primary);border-bottom:1px dashed var(--primary);font-weight:500;">'+fmt(p.sellPrice)+' грн</span></td>';
        case 'margin': return '<td data-label="Маржа" class="'+(margin>0?'text-success':'text-danger')+'">'+fmt(margin)+' грн <span style="font-size:11px;opacity:0.7;">('+marginPct+'%)</span></td>';
        case 'canProduce': return '<td data-label="Можна зібрати">'+can+' шт</td>';
        default: return '<td>—</td>';
      }
    }
  
    // Групування по категоріях (як у матеріалах) — зберігає поточну сортування всередині групи
    var groups = {};
    filtered.forEach(function(p) {
      var cat = p.category || '';
      if (!groups[cat]) groups[cat] = [];
      groups[cat].push(p);
    });
    var groupNames = Object.keys(groups).sort(function(a, b) {
      if (!a && b) return 1;
      if (!b && a) return -1;
      return a.localeCompare(b, 'uk');
    });
    var totalCols = visCols.length + 2; // checkbox + дії
  
    function renderProdRow(p) {
      var can = calcCanProduce(p, db.materials);
      var cost = calcCost(p, db.materials);
      var margin = p.sellPrice - cost.total;
      var marginPct = p.sellPrice > 0 ? Math.round(margin / p.sellPrice * 100) : 0;
      var inactive = p.active===false;
      var atW = _atWorker[p.id] || 0;
      var cells = visCols.map(function(c){ return cellHtml(c.id, p, cost, can, margin, marginPct, atW, inactive); }).join('');
      return '<tr style="'+(inactive?'opacity:0.45;background:#f9f9f9;':'')+'">'+
        '<td><input type="checkbox" class="prod-cb" value="'+p.id+'" onchange="updateProdSelection()" style="width:18px;height:18px;accent-color:var(--primary);"></td>'+
        cells+
        '<td data-label="Дії" style="white-space:nowrap;">'+(p.active===false?
          '<button class="btn btn-success btn-sm" onclick="toggleProduct(\''+p.id+'\',true)" title="Активувати">&#x25B6;</button> ':
          '<button class="btn btn-outline btn-sm" onclick="toggleProduct(\''+p.id+'\',false)" title="Деактивувати" style="opacity:0.6;">&#x23F8;</button> ')+
          (p.fulfillment && Object.keys(p.fulfillment).some(function(k){return p.fulfillment[k]>0}) ? '<button class="btn btn-outline btn-sm" onclick="returnFromFulfillment(\''+p.id+'\')" title="Повернути з фулфілменту" style="opacity:0.7;">↩️</button> ' : '')+
          '<button class="btn btn-outline btn-sm" onclick="openStockAdjust(\''+p.id+'\')" title="Коригування складу">📦</button> '+
          '<button class="btn btn-outline btn-sm" onclick="duplicateProduct(\''+p.id+'\')" title="Копіювати">📑</button> '+
          '<button class="btn btn-outline btn-sm" onclick="editProduct(\''+p.id+'\')">&#x270F;&#xFE0F;</button> <button class="btn btn-danger btn-sm" onclick="deleteProduct(\''+p.id+'\')">&#x1F5D1;</button></td>'+
      '</tr>';
    }
  
    var html = '';
    groupNames.forEach(function(cat) {
      var list = groups[cat];
      var label = cat || '📋 Без категорії';
      var color = _prodCategoryColor(cat);
      html += '<tr class="prod-cat-header"><td colspan="'+totalCols+'" style="background:'+color+';padding:10px 16px;font-weight:700;font-size:14px;letter-spacing:0.3px;">'+esc(label)+' <span style="font-weight:400;font-size:12px;color:var(--text-light);">('+list.length+')</span></td></tr>';
      list.forEach(function(p){ html += renderProdRow(p); });
    });
  
    var tb = document.getElementById('products-table');
    tb.innerHTML = html || '<tr><td colspan="'+totalCols+'" class="text-muted" style="text-align:center;padding:40px;">Нічого не знайдено</td></tr>';
  
    renderFulfillmentLocations();
    applyFfManagerState();
  }
  
  function toggleAllProducts(checked) {
    document.querySelectorAll('.prod-cb').forEach(function(cb){ cb.checked = checked; });
    updateProdSelection();
  }
  
  function updateProdSelection() {
    var checked = document.querySelectorAll('.prod-cb:checked');
    var bar = document.getElementById('prod-bulk-bar');
    if (checked.length > 0) {
      bar.style.display = 'flex';
      document.getElementById('prod-selected-count').textContent = 'Обрано: ' + checked.length;
    } else {
      bar.style.display = 'none';
    }
    var all = document.querySelectorAll('.prod-cb');
    document.getElementById('prod-select-all').checked = all.length > 0 && checked.length === all.length;
  }
  
  function clearProdSelection() {
    document.querySelectorAll('.prod-cb').forEach(function(cb){ cb.checked = false; });
    document.getElementById('prod-select-all').checked = false;
    document.getElementById('prod-bulk-bar').style.display = 'none';
  }
  
  function bulkSelectedProducts(activate) {
    var ids = [];
    document.querySelectorAll('.prod-cb:checked').forEach(function(cb){ ids.push(cb.value); });
    if (!ids.length) return;
    var action = activate ? 'активувати' : 'деактивувати';
    if (ids.length >= 5) {
      if (!confirm(action.charAt(0).toUpperCase()+action.slice(1)+' '+ids.length+' гр? Це змінить їх всіх одразу.')) return;
    }
    var db = getDB();
    ids.forEach(function(id) {
      var p = db.products.find(function(x){ return x.id === id; });
      if (p) p.active = activate;
    });
    saveDB(db);
    renderProducts();
  }
  
  function resetAllCosts() {
    if (!confirm('Скинути собівартість у ВСІХ ігор?\n\nБуде очищено:\n• Рецепти (матеріали)\n• Сторінки друку\n• Ставки майстрів\n\nСобівартість стане 0 грн.\nПотім заповниш через технологічну карту.')) return;
    var db = getDB();
    var count = 0;
    db.products.forEach(function(p) {
      p.recipe = [];
      p.pages = 0;
      p.workerRate = 0;
      p.workerRateType = 'percent';
      p.packagingCost = 0; p.packagingKitId = null;
      p.templateCost = 0;
      p.templateQty = 0;
      p.templateCovered = 0;
      count++;
    });
    saveDB(db);
    renderProducts();
    alert('Готово! Скинуто собівартість у ' + count + ' ігор.');
  }

  // Експорт ВСІХ функцій — багато з них викликаються з inline onclick або з інших модулів
  window.refreshRecipeOptions = refreshRecipeOptions;
  window.addRecipeLine = addRecipeLine;
  window.getRecipeFromContainer = getRecipeFromContainer;
  window.saveProduct = saveProduct;
  window.editProduct = editProduct;
  window.updateProduct = updateProduct;
  window.updateRatePreview = updateRatePreview;
  window.updatePrintPreview = updatePrintPreview;
  window.updateTemplatePreview = updateTemplatePreview;
  window.openStockAdjust = openStockAdjust;
  window.updateSaPreview = updateSaPreview;
  window.applyStockAdjust = applyStockAdjust;
  window.duplicateProduct = duplicateProduct;
  window.deleteProduct = deleteProduct;
  window.toggleProduct = toggleProduct;
  window.effectiveRecipeQty = effectiveRecipeQty;
  window.effectiveNeed = effectiveNeed;
  window.calcCanProduce = calcCanProduce;
  window.calcCost = calcCost;
  window.getCategories = getCategories;
  window.renderCatManager = renderCatManager;
  window.addCategory = addCategory;
  window.renameCategory = renameCategory;
  window.deleteCategory = deleteCategory;
  window.populateCategorySelects = populateCategorySelects;
  window.getProdCols = getProdCols;
  window.saveProdCols = saveProdCols;
  window.toggleProdColSettings = toggleProdColSettings;
  window.renderProdColSettings = renderProdColSettings;
  window.toggleProdCol = toggleProdCol;
  window.moveProdCol = moveProdCol;
  window.saveProdColSettings = saveProdColSettings;
  window.resetProdCols = resetProdCols;
  window.sortProducts = sortProducts;
  window.updateSortIcons = updateSortIcons;
  window.renderProducts = renderProducts;
  window.toggleAllProducts = toggleAllProducts;
  window.updateProdSelection = updateProdSelection;
  window.clearProdSelection = clearProdSelection;
  window.bulkSelectedProducts = bulkSelectedProducts;
  window.resetAllCosts = resetAllCosts;
})();
