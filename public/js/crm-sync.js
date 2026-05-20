// ============================================================
// LipoLand — SalesDrive CRM sync module
// ============================================================
// Settings, connection test, sync orders (with status mapping, TTN,
// pagination, processOrdersBatch). Залежить від autoMatchCrmSku (з crm-mapper.js).
// SD_SETTINGS_KEY — глобальна константа.

(function(){
  'use strict';

  // ==================== SALESDRIVE CRM ====================
  var SD_SETTINGS_KEY = 'lipoland_crm_settings';
  
  function getCrmSettings() {
    try { return JSON.parse(localStorage.getItem(SD_SETTINGS_KEY)) || {}; } catch { return {}; }
  }
  
  function hasCrmKey() {
    var s = getCrmSettings();
    return !!(s.domain && s.apiKey);
  }
  
  function toggleCrmVisibility() {
    var show = hasCrmKey();
    var f = getFeatures();
    // If crm feature is off, always hide; otherwise respect hasCrmKey
    if (!f.crm) show = false;
    var els = document.querySelectorAll('.crm-only');
    for (var i = 0; i < els.length; i++) {
      els[i].style.display = show ? '' : 'none';
    }
  }
  
  // ==================== FEATURE TOGGLES ====================
  // → винесено в public/js/features.js (getFeatures, saveFeatures, isFeatureOn,
  //   applyFeatures, showFeatureWizard, finishFeatureWizard, checkFeatureWizard,
  //   renderSettingsFeatures, toggleFeatureSetting)
  
  
  function saveCrmSettings() {
    var settings = { domain: v('sd-domain').trim(), apiKey: v('sd-apikey').trim() };
    if(!settings.domain || !settings.apiKey) return alert('Заповніть домен та API-ключ');
    // Save to server
    fetch('/api/crm-settings', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(settings) })
      .then(function(r){ return r.json(); })
      .then(function(data){
        if(data.ok) {
          localStorage.setItem(SD_SETTINGS_KEY, JSON.stringify(settings));
          toggleCrmVisibility();
          alert('Збережено! Кнопки синхронізації тепер доступні в розділі Замовлення.');
        } else {
          alert('Помилка: '+(data.error||'невідомо'));
        }
      }).catch(function(){ alert('Помилка збереження'); });
  }
  
  function loadCrmSettings() {
    fetch('/api/crm-settings').then(function(r){ return r.json(); }).then(function(data){
      if(data.domain) {
        var settings = { domain: data.domain, apiKey: data.apiKey || '' };
        localStorage.setItem(SD_SETTINGS_KEY, JSON.stringify(settings));
        document.getElementById('sd-domain').value = settings.domain;
        document.getElementById('sd-apikey').value = settings.apiKey;
      }
      toggleCrmVisibility();
      // Update orders description based on CRM presence
      var desc = document.getElementById('orders-desc');
      if (desc) {
        desc.textContent = hasCrmKey()
          ? 'Замовлення з CRM або створені вручну. Оберіть дату, з якої підтягти замовлення. Призначайте майстра, вказуйте канал продажу, відстежуйте статус.'
          : 'Замовлення створені вручну. Призначайте майстра, вказуйте канал продажу, відстежуйте статус.';
      }
    }).catch(function(){ toggleCrmVisibility(); });
  }
  
  function testCrmConnection() {
    var domain = v('sd-domain').trim();
    var apiKey = v('sd-apikey').trim();
    if(!domain || !apiKey) return alert('Спочатку заповніть та збережіть домен і API-ключ');
    var el = document.getElementById('crm-test-result');
    el.innerHTML = '<span class="text-muted">Перевірка...</span>';
    // Save first, then test
    fetch('/api/crm-settings', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ domain: domain, apiKey: apiKey }) })
      .then(function(){ return fetch('/api/salesdrive/proxy', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ path:'/api/statuses/' }) }); })
      .then(function(r){return r.json()})
      .then(function(data) {
        if(data.success) {
          localStorage.setItem(SD_SETTINGS_KEY, JSON.stringify({ domain: domain, apiKey: apiKey }));
          var statuses = data.data.map(function(s){return s.name}).join(', ');
          el.innerHTML = '<span class="text-success">✅ Підключено! Статуси: '+statuses+'</span>';
        } else {
          el.innerHTML = '<span class="text-danger">❌ Помилка: '+(data.error || JSON.stringify(data))+'</span>';
        }
      })
      .catch(function(err) {
        el.innerHTML = '<span class="text-danger">❌ Помилка з\'єднання: '+err.message+'</span>';
      });
  }
  
  // Set the CRM sync "from" date to N days ago
  function setSyncDatePreset(daysBack) {
    var d = new Date();
    d.setDate(d.getDate() - daysBack);
    var el = document.getElementById('sync-from-date');
    if (el) {
      el.value = d.toISOString().slice(0,10);
      localStorage.setItem('lipo_sync_from_date', el.value);
    }
  }
  
  // Initialise sync date input on orders page render (saved value or default 30 days)
  function initSyncDateInput() {
    var el = document.getElementById('sync-from-date');
    if (!el) return;
    if (el.value) return;
    var saved = localStorage.getItem('lipo_sync_from_date');
    if (saved) { el.value = saved; return; }
    var d = new Date();
    d.setDate(d.getDate() - 30);
    el.value = d.toISOString().slice(0,10);
  }
  
  // ==================== NOVA POSHTA TRACKING ====================
  // → винесено в public/js/np-tracking.js (statusToVisualNP, syncOrderStatusFromTracking,
  //   ttnLooksLikeNP, trackNpOrders, maybeAutoRefreshNpTracking, manualRefreshNpTracking)
  
  
  function syncSalesDrive() {
    var btn = document.getElementById('sync-btn');
    var statusEl = document.getElementById('sync-status');
    btn.disabled = true;
    btn.textContent = '⏳ Синхронізація...';
  
    // Read "from" date from UI (user can pick custom); fall back to 30 days back.
    var fromInput = document.getElementById('sync-from-date');
    var fromStr;
    if (fromInput && fromInput.value) {
      fromStr = fromInput.value + ' 00:00:00';
      localStorage.setItem('lipo_sync_from_date', fromInput.value);
    } else {
      var fromDate = new Date();
      fromDate.setDate(fromDate.getDate() - 30);
      fromStr = fromDate.toISOString().slice(0,10) + ' 00:00:00';
    }
    statusEl.innerHTML = '<span class="text-muted">Завантаження замовлень з SalesDrive з '+esc(fromStr.slice(0,10))+'...</span>';
  
    var db = getDB();
    // Get existing CRM order IDs to avoid duplicates
    var existingCrmIds = {};
    db.orders.forEach(function(o){ if(o.crmId) existingCrmIds[o.crmId] = true; });
  
    var newCount = 0;
    var updatedCount = 0;
    var totalFetched = 0;
    var MAX_PAGES = 30; // safety cap: 30 * 100 = 3000 orders
  
    // SalesDrive rate limit: 10 req/min on /api/order/list/. Тримаємо запас.
    var SD_PAGE_DELAY_MS = 7000;     // 7с між сторінками → ~8.5 req/min
    var SD_RATE_RETRY_MS = 65000;    // при 'API limit reached' — чекаємо 65с
    var SD_MAX_RATE_RETRIES = 3;     // максимум 3 ретраї на одну сторінку
  
    function isRateLimit(msg) {
      return /api\s*limit\s*reached/i.test(String(msg || ''));
    }
  
    function fetchPage(page, retriesLeft) {
      if (retriesLeft === undefined) retriesLeft = SD_MAX_RATE_RETRIES;
      var sdPath = '/api/order/list/?page='+page+'&limit=100&filter[orderTime][from]='+encodeURIComponent(fromStr)+'&filter[statusId]=__NOTDELETED__';
      statusEl.innerHTML = '<span class="text-muted">Завантаження сторінки '+page+' з CRM...</span>';
      return fetch('/api/salesdrive/proxy', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ path: sdPath }) })
        .then(function(r){
          return r.text().then(function(txt){
            var data;
            try { data = JSON.parse(txt); }
            catch(e){
              console.warn('[lipo] SalesDrive proxy non-JSON response:', r.status, txt.slice(0, 300));
              throw new Error('Невірна відповідь сервера (HTTP '+r.status+'): '+txt.slice(0, 120));
            }
            return { status: r.status, data: data };
          });
        })
        .then(function(wrap){
          var data = wrap.data;
          // Окремо ловимо rate-limit — чекаємо і повторюємо, а не падаємо
          if (data && isRateLimit(data.error || data.message)) {
            if (retriesLeft <= 0) {
              throw new Error('API limit SalesDrive — перевищено 3 спроби. Спробуйте пізніше.');
            }
            var waitSec = Math.round(SD_RATE_RETRY_MS/1000);
            console.warn('[lipo] SalesDrive rate limit hit, waiting', waitSec, 's');
            return countdownWait(SD_RATE_RETRY_MS, function(secLeft){
              statusEl.innerHTML = '<span style="color:#E65100;">⏸ Ліміт API SalesDrive (10/хв). Пауза '+secLeft+'с… сторінка '+page+'</span>';
            }).then(function(){ return fetchPage(page, retriesLeft - 1); });
          }
          if(data.error) throw new Error(data.error);
          if(!data.data) {
            console.warn('[lipo] SalesDrive unexpected response shape:', data);
            var msg = data.message || data.status || JSON.stringify(data).slice(0, 200);
            throw new Error('Невірна відповідь API: ' + msg);
          }
          processOrdersBatch(data.data);
          totalFetched += (data.data || []).length;
          var totalPages = (data.pagination && data.pagination.pageCount) || 1;
          if (page < totalPages && page < MAX_PAGES) {
            // Пауза між сторінками, щоб не впертись у 10/хв
            return countdownWait(SD_PAGE_DELAY_MS, function(secLeft){
              statusEl.innerHTML = '<span class="text-muted">Сторінка '+page+' з '+totalPages+' ✓ — пауза '+secLeft+'с (щоб не впертись у ліміт SalesDrive)…</span>';
            }).then(function(){ return fetchPage(page + 1); });
          }
          return { totalPages: totalPages };
        });
    }
  
    // Пауза з видимим лічильником. cb(secLeft) викликається щосекунди.
    function countdownWait(totalMs, cb) {
      return new Promise(function(resolve){
        var left = Math.ceil(totalMs/1000);
        try { cb(left); } catch(e){}
        if (left <= 0) { resolve(); return; }
        var timer = setInterval(function(){
          left -= 1;
          if (left <= 0) { clearInterval(timer); resolve(); return; }
          try { cb(left); } catch(e){}
        }, 1000);
      });
    }
  
    var _ttnDebugCount = 0;

    // Авто-детекція каналу продажу з замовлення SalesDrive.
    // SalesDrive не передає канал окремим полем, тому скануємо весь об'єкт
    // замовлення на ключові слова маркетплейсів. Слова специфічні —
    // хибних збігів практично не буде.
    var CHANNEL_KEYWORDS = [
      { keys: ['rozetka', 'розетка'],          channel: 'Rozetka' },
      { keys: ['prom.ua', 'prom.market'],      channel: 'Prom' },
      { keys: ['etsy'],                         channel: 'Etsy' },
      { keys: ['instagram', 'інстаграм'],       channel: 'Instagram' },
      { keys: ['telegram', 'телеграм'],         channel: 'Telegram' }
    ];
    function detectOrderChannel(o) {
      var hay = '';
      try { hay = JSON.stringify(o).toLowerCase(); } catch(e) { return ''; }
      for (var i = 0; i < CHANNEL_KEYWORDS.length; i++) {
        var rule = CHANNEL_KEYWORDS[i];
        for (var k = 0; k < rule.keys.length; k++) {
          if (hay.indexOf(rule.keys[k]) !== -1) return rule.channel;
        }
      }
      return '';
    }
    // Гарантує що канал є у db.orderChannels (щоб з'явився у фільтрі/селекті)
    function ensureChannel(db, channelName) {
      if (!channelName) return;
      if (!db.orderChannels) db.orderChannels = [];
      if (db.orderChannels.indexOf(channelName) === -1) db.orderChannels.push(channelName);
    }

    function processOrdersBatch(orders) {
  
        orders.forEach(function(o) {
          try {
          // Filter: only products with "lipoland" or "Lipoland" in name
          var lipoProducts = (o.products||[]).filter(function(p) {
            return (p.text||'').toLowerCase().indexOf('lipoland') !== -1;
          });
          if(lipoProducts.length === 0) return;
  
          // Log TTN extraction for debugging (first 5 orders only)
          if (_ttnDebugCount < 5 && ttn) {
            _ttnDebugCount++;
            console.log('[lipo] ✅ TTN imported: order #'+o.id+' → '+ttn+' (carrier: '+(carrier||dd.provider||'?')+')');
          }
  
          var contact = o.primaryContact || {};
          var firstName = (contact.fName||'').trim();
          var lastName = (contact.lName||'').trim();
          var clientName = (firstName + ' ' + lastName).trim();
          var phone = (contact.phone && contact.phone[0]) || '';
          var email = (contact.email && contact.email[0]) || '';
  
          // Map SalesDrive status to our status
          var sdStatusMap = {1:'new', 3:'confirmed', 4:'shipped', 5:'completed', 6:'completed', 10:'new'};
          var ourStatus = sdStatusMap[o.statusId] || 'new';
  
          // Parse delivery data (ord_delivery_data is an ARRAY in SalesDrive!)
          var _raw = o.ord_delivery_data;
          var dd = {};
          try {
            if (Array.isArray(_raw) && _raw.length > 0 && _raw[0] && typeof _raw[0] === 'object') dd = _raw[0];
            else if (_raw && typeof _raw === 'object' && !Array.isArray(_raw)) dd = _raw;
          } catch(e) { console.warn('[lipo] dd parse error:', e, '_raw:', JSON.stringify(_raw).slice(0,200)); dd = {}; }
  
          var shipMethod = o.shipping_method || o.shippingMethod || '';
          var carrier = '';
          if (shipMethod && isNaN(shipMethod)) {
            var sm = String(shipMethod).toLowerCase();
            if (sm.indexOf('нова') !== -1 || sm.indexOf('nova') !== -1 || sm.indexOf('np') !== -1) carrier = 'nova';
            else if (sm.indexOf('укрпошт') !== -1 || sm.indexOf('ukrposhta') !== -1 || sm.indexOf('ukr') !== -1) carrier = 'ukrposhta';
            else if (sm.indexOf('meest') !== -1 || sm.indexOf('міст') !== -1) carrier = 'meest';
            else if (sm.indexOf('курʼ') !== -1 || sm.indexOf('курь') !== -1 || sm.indexOf('courier') !== -1) carrier = 'courier';
            else if (sm.indexOf('самовив') !== -1 || sm.indexOf('pickup') !== -1) carrier = 'pickup';
            else carrier = 'other';
          }
          // Auto-detect carrier from delivery data
          if (!carrier && dd.provider) {
            var prov = String(dd.provider).toLowerCase();
            if (prov.indexOf('nova') !== -1) carrier = 'nova';
            else if (prov.indexOf('ukr') !== -1) carrier = 'ukrposhta';
          }
          var shipCity = o.shipping_city || o.shippingCity || dd.cityName || '';
          var shipWarehouse = o.shipping_warehouse || o.shippingWarehouse || dd.branchNumber || dd.wareHouseRef || '';
          var shipAddress = o.shipping_address || o.shippingAddress || dd.address || o.adresaDostavki || '';
          var ttn = dd.trackingNumber || dd.ttn || dd.IntDocNumber || dd.intDocNumber || '';
          if (!ttn) ttn = o.trackingNumber || o.ttn || '';
          // Fallback: check primaryContact.comment for 14-digit numbers
          if (!ttn) {
            var comment = (o.primaryContact && o.primaryContact.comment) || '';
            var ttnMatch = String(comment).match(/\b(\d{14})\b/);
            if (ttnMatch) ttn = ttnMatch[1];
          }
          ttn = String(ttn||'').trim();
          // Auto-detect carrier from TTN format (override 'other' too)
          if (ttn && (!carrier || carrier === 'other') && /^\d{14}$/.test(ttn)) carrier = 'nova';
          if (ttn) console.warn('[lipo] ✅ CRM order #'+o.id+' TTN result: "'+ttn+'" carrier: '+carrier);
  
          // Best-effort payment mapping
          var payMethod = o.payment_method || o.paymentMethod || '';
          var paymentType = '';
          if (payMethod) {
            var pm = String(payMethod).toLowerCase();
            if (pm.indexOf('післяпл') !== -1 || pm.indexOf('cod') !== -1 || pm.indexOf('наложен') !== -1) paymentType = 'cod';
            else if (pm.indexOf('передопл') !== -1 || pm.indexOf('prepay') !== -1 || pm.indexOf('карт') !== -1) paymentType = 'prepayment';
            else if (pm.indexOf('iban') !== -1 || pm.indexOf('рахунок') !== -1) paymentType = 'iban';
            else if (pm.indexOf('готів') !== -1 || pm.indexOf('cash') !== -1) paymentType = 'cash';
            else paymentType = 'other';
          }
          var paymentStatus = o.payment_status === 'paid' || o.paymentStatus === 'paid' || o.payed === 1 ? 'paid' : 'unpaid';
  
          // Match products to our catalog. Multi-tier strategy — CRM often puts the
          // SKU inside the product name string (e.g. "LP1246A5 A5 Візуальний розклад"),
          // while our catalog keeps SKU as a separate field. We try several signals.
          var crmSkuMap = db.crmSkuMap || {};
          var items = lipoProducts.map(function(sp) {
            var rawSku = sp.sku || '';
            var sku = rawSku.replace(/_mamulya$/i,'').replace(/-Boy$/i,'').replace(/-Girl$/i,'');
            var crmName = sp.text || sp.title || '';
            var crmNameLower = crmName.toLowerCase().trim();
            var matched = null;
  
            // 1) Manual mapping has highest priority
            if (rawSku && crmSkuMap[rawSku]) {
              matched = db.products.find(function(p){ return p.id === crmSkuMap[rawSku]; });
            }
            // 2) Auto-match by explicit SKU (bidirectional prefix)
            if (!matched && (sku || rawSku)) {
              matched = db.products.find(function(p){
                if (!p.sku) return false;
                return p.sku === sku || p.sku === rawSku
                    || (sku && sku.indexOf(p.sku) === 0) || (sku && p.sku.indexOf(sku) === 0);
              });
            }
            // 3) Tokenize CRM name and try each token as a SKU (exact, case-insensitive).
            //    CRM often sends "LP1246A5 A5 Візуальний розклад" — our SKU appears as a token.
            //    Longest tokens first to prefer specific SKUs over generic ones.
            if (!matched && crmNameLower) {
              var tokens = crmNameLower.split(/[\s\-_,;()\/]+/).filter(function(t){ return t.length >= 3; });
              tokens.sort(function(a,b){ return b.length - a.length; });
              for (var ti = 0; ti < tokens.length && !matched; ti++) {
                var tok = tokens[ti];
                matched = db.products.find(function(p){
                  return p.sku && p.sku.toLowerCase() === tok;
                });
              }
            }
            // 4) Exact name match (case-insensitive, trimmed). Strips leading SKU-like token first.
            if (!matched && crmNameLower) {
              var stripped = crmNameLower.replace(/^\S+\s+/, ''); // drop leading "LP1246A5 " if present
              matched = db.products.find(function(p){
                if (!p.name) return false;
                var pn = p.name.toLowerCase().trim();
                return pn === crmNameLower || pn === stripped;
              });
            }
            // 5) Our product name appears as substring of CRM name (only if name is long
            //    enough to avoid generic matches like "А5"). Longest catalog names first.
            if (!matched && crmNameLower) {
              var candidates = db.products.filter(function(p){ return p.name && p.name.length >= 6; });
              candidates.sort(function(a,b){ return (b.name||'').length - (a.name||'').length; });
              matched = candidates.find(function(p){
                return crmNameLower.indexOf(p.name.toLowerCase().trim()) !== -1;
              });
            }
            return {
              productId: matched ? matched.id : null,
              name: crmName || 'Невідомий товар',
              sku: rawSku || sku || '',
              qty: sp.amount || 1,
              price: sp.price || 0
            };
          });
  
          var total = items.reduce(function(s,i){return s + i.qty * i.price}, 0);

          // Авто-детекція каналу (Rozetka / Prom / Etsy / Instagram / Telegram)
          var detectedChannel = detectOrderChannel(o);

          if(existingCrmIds[o.id]) {
            // Update existing order status + backfill delivery/payment if empty
            var existing = db.orders.find(function(x){return x.crmId===o.id});
            if (existing) {
              if (existing.status==='new' && ourStatus!=='new') {
                existing.crmStatus = o.statusId;
                updatedCount++;
              }
              // Backfill fields that might have been empty for existing orders
              if (!existing.firstName && firstName) existing.firstName = firstName;
              if (!existing.lastName && lastName) existing.lastName = lastName;
              if (!existing.email && email) existing.email = email;
              if (!existing.carrier && carrier) existing.carrier = carrier;
              if (!existing.city && shipCity) existing.city = shipCity;
              if (!existing.warehouse && shipWarehouse) existing.warehouse = String(shipWarehouse);
              if (!existing.address && shipAddress) existing.address = shipAddress;
              // TTN: ALWAYS update from CRM (user may add TTN after initial sync)
              if (ttn) {
                if (existing.ttn !== ttn) {
                  console.log('[lipo] Updating TTN for order #'+existing.num+': "'+existing.ttn+'" → "'+ttn+'"');
                  existing.ttn = ttn;
                  updatedCount++;
                }
              }
              if (!existing.paymentType && paymentType) existing.paymentType = paymentType;
              if (!existing.paymentStatus && paymentStatus) existing.paymentStatus = paymentStatus;
              // Backfill каналу — тільки якщо ще не заданий (не перезаписуємо ручний вибір)
              if (!existing.channel && detectedChannel) {
                existing.channel = detectedChannel;
                ensureChannel(db, detectedChannel);
                updatedCount++;
              }
            }
          } else {
            // Create new order with full delivery/payment info
            ensureChannel(db, detectedChannel);
            db.orders.push({
              id: uid(),
              num: db.nextOrderNum++,
              crmId: o.id,
              crmStatus: o.statusId,
              date: (o.orderTime||'').slice(0,10),
              firstName: firstName,
              lastName: lastName,
              client: clientName,
              phone: phone,
              email: email,
              carrier: carrier,
              city: shipCity,
              warehouse: String(shipWarehouse||''),
              address: shipAddress,
              ttn: String(ttn||''),
              paymentType: paymentType,
              paymentStatus: paymentStatus,
              channel: detectedChannel || '',
              items: items,
              total: total,
              status: 'new', // Always start as "new" in our system — user confirms manually
              source: 'salesdrive'
            });
            newCount++;
          }
          } catch(orderErr) {
            console.error('[lipo] ❌ Error processing CRM order #'+o.id+':', orderErr.message, orderErr.stack);
          }
        });
    } // end processOrdersBatch
  
    fetchPage(1)
      .then(function(info){
        saveDB(db);
        btn.disabled = false;
        btn.textContent = '🔄 Синхронізувати з CRM';
        var cappedNote = (info && info.totalPages > MAX_PAGES) ? '<br><span class="text-muted" style="font-size:12px;">⚠ Показано перші '+MAX_PAGES+' сторінок. Виберіть новіший період, щоб охопити менше замовлень.</span>' : '';
        // Count orders with TTN for user feedback
        var ordersWithTtn = db.orders.filter(function(x){return x.ttn && x.ttn.length > 5;}).length;
        var ttnNote = ordersWithTtn ? '<br><span class="text-muted" style="font-size:12px;">📦 Замовлень з ТТН: <strong>'+ordersWithTtn+'</strong></span>' : '';
        statusEl.innerHTML = '<span class="text-success">✅ Синхронізовано з '+esc(fromStr.slice(0,10))+'! Замовлень в CRM: <strong>'+totalFetched+'</strong>, нових: <strong>'+newCount+'</strong>, оновлено: '+updatedCount+'</span>' +
          '<br><span class="text-muted" style="font-size:12px;">Останнє оновлення: '+new Date().toLocaleString('uk')+'</span>' + ttnNote + cappedNote;
        renderOrders();
        // Auto-trigger NP tracking for newly imported TTNs
        if (ordersWithTtn > 0 && typeof trackNpOrders === 'function') {
          console.log('[lipo] Auto-tracking NP after sync, orders with TTN:', ordersWithTtn);
          trackNpOrders({force:true}).then(function(r){
            if (r && r.updated > 0) {
              statusEl.innerHTML += '<br><span class="text-success" style="font-size:12px;">🚚 Трекінг НП оновлено: <strong>'+r.updated+'</strong> замовлень</span>';
              renderOrders();
            }
          }).catch(function(){});
        }
      })
      .catch(function(err) {
        btn.disabled = false;
        btn.textContent = '🔄 Синхронізувати з CRM';
        statusEl.innerHTML = '<span class="text-danger">❌ Помилка: '+err.message+'</span>';
      });
  }

  // SD_SETTINGS_KEY використовується з crm-mapper (для імпорту товарів) — на window
  window.SD_SETTINGS_KEY = SD_SETTINGS_KEY;
  window.getCrmSettings = getCrmSettings;
  window.hasCrmKey = hasCrmKey;
  window.toggleCrmVisibility = toggleCrmVisibility;
  window.saveCrmSettings = saveCrmSettings;
  window.loadCrmSettings = loadCrmSettings;
  window.testCrmConnection = testCrmConnection;
  window.setSyncDatePreset = setSyncDatePreset;
  window.initSyncDateInput = initSyncDateInput;
  window.syncSalesDrive = syncSalesDrive;
})();
