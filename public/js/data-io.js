// ============================================================
// LipoLand — Data I/O module
// ============================================================
// CSV/Excel import-export, JSON експорт/імпорт, reset все.

(function(){
  'use strict';

  // ==================== EXCEL IMPORT/EXPORT ====================
  function downloadExcelTemplate(type) {
    var rows = [];
    var filename = '';
  
    if (type === 'products') {
      rows.push(['Артикул', 'Назва', 'Категорія', 'Розмір', 'На складі', 'Ціна продажу (грн)', 'Нотатки']);
      rows.push(['LP-001', 'Книжка Ферма', 'Книжки', '20x20', '5', '850', 'Приклад - видаліть цей рядок']);
      rows.push(['LP-002', 'Гра Алфавіт', 'Ігри', '30x30', '3', '1200', '']);
      filename = 'lipoland-шаблон-товари.csv';
    } else {
      rows.push(['Назва', 'Одиниця', 'Залишок', 'Мінімум', 'Ціна за од. (грн)', 'Постачальник', 'Нотатки']);
      rows.push(['Фетр жовтий 1мм', 'м', '5', '2', '120', 'Текстиль-опт', 'Приклад - видаліть цей рядок']);
      rows.push(['Ліпучка 2см біла', 'м', '20', '5', '8', '', '']);
      filename = 'lipoland-шаблон-матеріали.csv';
    }
  
    // BOM for Excel UTF-8 recognition
    var csvContent = '\uFEFF' + rows.map(function(r) {
      return r.map(function(cell) {
        return '"' + String(cell).replace(/"/g, '""') + '"';
      }).join(';');
    }).join('\n');
  
    var blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
  }
  
  function importExcel(event) {
    var file = event.target.files[0];
    if (!file) return;
    var resultEl = document.getElementById('excel-import-result');
    resultEl.innerHTML = '<span class="text-muted">Обробка файлу...</span>';
  
    var reader = new FileReader();
    reader.onload = function(e) {
      try {
        var text = e.target.result;
        // Detect separator (;  or ,)
        var sep = text.indexOf(';') > -1 ? ';' : ',';
        var lines = text.split('\n').map(function(l) { return l.trim(); }).filter(Boolean);
        if (lines.length < 2) { resultEl.innerHTML = '<span class="text-danger">Файл порожній або має лише заголовок</span>'; return; }
  
        var header = parseCSVLine(lines[0], sep);
        var h0 = header[0].replace(/^\uFEFF/, '').toLowerCase().trim();
  
        var db = getDB();
        var count = 0;
  
        if (h0 === 'артикул' || h0 === 'sku') {
          // Products import
          for (var i = 1; i < lines.length; i++) {
            var cols = parseCSVLine(lines[i], sep);
            if (cols.length < 2 || !cols[1].trim()) continue;
            db.products.push({
              id: uid(),
              sku: cols[0] ? cols[0].trim() : '',
              name: cols[1].trim(),
              category: cols[2] ? cols[2].trim() : '',
              size: cols[3] ? cols[3].trim() : '',
              stock: cols[4] ? parseInt(cols[4]) || 0 : 0,
              inProgress: 0,
              sellPrice: cols[5] ? parseFloat(cols[5]) || 0 : 0,
              note: cols[6] ? cols[6].trim() : '',
              recipe: [],
              active: true
            });
            count++;
          }
          saveDB(db);
          resultEl.innerHTML = '<span class="text-success">✅ Імпортовано <b>' + count + '</b> товарів!</span>';
          renderPage('products');
        } else if (h0 === 'назва' || h0 === 'name') {
          // Materials import
          for (var i = 1; i < lines.length; i++) {
            var cols = parseCSVLine(lines[i], sep);
            if (cols.length < 1 || !cols[0].trim()) continue;
            db.materials.push({
              id: uid(),
              name: cols[0].trim(),
              unit: cols[1] ? cols[1].trim() : 'шт',
              qty: cols[2] ? parseFloat(cols[2]) || 0 : 0,
              min: cols[3] ? parseFloat(cols[3]) || 0 : 0,
              price: cols[4] ? parseFloat(cols[4]) || 0 : 0,
              supplier: cols[5] ? cols[5].trim() : '',
              note: cols[6] ? cols[6].trim() : ''
            });
            count++;
          }
          saveDB(db);
          resultEl.innerHTML = '<span class="text-success">✅ Імпортовано <b>' + count + '</b> матеріалів!</span>';
          renderPage('materials');
        } else {
          resultEl.innerHTML = '<span class="text-danger">Невідомий формат. Перший стовпець має бути "Артикул" (товари) або "Назва" (матеріали).</span>';
        }
      } catch(err) {
        resultEl.innerHTML = '<span class="text-danger">Помилка: ' + esc(err.message) + '</span>';
      }
    };
    reader.readAsText(file, 'UTF-8');
    event.target.value = '';
  }
  
  function parseCSVLine(line, sep) {
    var result = [];
    var current = '';
    var inQuotes = false;
    for (var i = 0; i < line.length; i++) {
      var c = line[i];
      if (inQuotes) {
        if (c === '"' && line[i+1] === '"') { current += '"'; i++; }
        else if (c === '"') { inQuotes = false; }
        else { current += c; }
      } else {
        if (c === '"') { inQuotes = true; }
        else if (c === sep) { result.push(current); current = ''; }
        else { current += c; }
      }
    }
    result.push(current);
    return result;
  }
  
  // ==================== EXPORT/IMPORT ====================
  function exportData() {
    var db = getDB();
    var blob = new Blob([JSON.stringify(db,null,2)], {type:'application/json'});
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'lipoland-inventory-'+new Date().toISOString().slice(0,10)+'.json';
    a.click();
  }
  
  function importData(event) {
    var file = event.target.files[0];
    if(!file) return;
    var reader = new FileReader();
    reader.onload = function(e) {
      try {
        var data = JSON.parse(e.target.result);
        saveDB(data);
        alert('Дані імпортовано!');
        location.reload();
      } catch(err) { alert('Помилка читання файлу'); }
    };
    reader.readAsText(file);
    event.target.value='';
  }
  
  function resetAllData() {
    var empty = { materials:[], products:[], production:[], orders:[], workers:['Майстер 1'], nextOrderNum:1, workerStock:[], workerStockHistory:[], equipment:[], serviceLog:[], printerSettings:{ colors:6, costPerPageA4:0 }, inkRefills:[], consumables:[], workerRateDefault:{ type:'percent', value:25 }, fulfillmentLocations:['Розетка'] };
    _dbCache = null;
    localStorage.removeItem(DB_KEY);
    localStorage.removeItem(SD_SETTINGS_KEY);
    localStorage.removeItem('lipo_read_notifs');
    localStorage.removeItem('lipo_onboarding_done');
    localStorage.removeItem('lipo_features');
    localStorage.removeItem('lipo_features_configured');
    fetch('/api/data', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(empty) }).then(function(){
      location.reload();
    }).catch(function(){ location.reload(); });
  }
  

  window.downloadExcelTemplate = downloadExcelTemplate;
  window.importExcel = importExcel;
  window.parseCSVLine = parseCSVLine;
  window.exportData = exportData;
  window.importData = importData;
  window.resetAllData = resetAllData;
})();
