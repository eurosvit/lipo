// ============================================================
// LipoLand — Orders module (core)
// ============================================================
// addOrderLine, saveOrder, setOrderStatus (з auto-return trigger),
// setOrderWorker, syncOrderAutoProduction, renderOrders (велика — табл з фільтрами,
// пагінацією, сортуванням, інлайн-редаг.), exportOrdersCsv, confirmOrder, deleteOrder.

(function(){
  'use strict';

  // ==================== ORDERS ====================
  function addOrderLine() {
    var db = getDB();
    var container = document.getElementById('ord-items');
    var div = document.createElement('div');
    div.className = 'form-row';
    div.innerHTML =
      '<div class="form-group"><label>Гра</label><select class="ord-prod" onchange="calcOrderTotal()">'+db.products.filter(function(p){return p.active!==false}).map(function(p){return '<option value="'+p.id+'" data-price="'+p.sellPrice+'">'+(p.sku?p.sku+' — ':'')+esc(p.name)+' ('+(p.stock||0)+' шт) — '+fmt(p.sellPrice)+' грн</option>';}).join('')+'</select></div>'+
      '<div class="form-group" style="max-width:100px"><label>К-сть</label><input class="ord-qty" type="number" value="1" min="1" onchange="calcOrderTotal()"></div>'+
      '<button class="btn btn-danger btn-sm" onclick="this.parentElement.remove();calcOrderTotal()">&#x2715;</button>';
    container.appendChild(div);
    calcOrderTotal();
  }
  
  function calcOrderTotal() {
    var db = getDB();
    var total = 0;
    document.querySelectorAll('#ord-items .form-row').forEach(function(row) {
      var prodId = row.querySelector('.ord-prod').value;
      var qty = parseInt(row.querySelector('.ord-qty').value)||0;
      var p = db.products.find(function(x){return x.id===prodId});
      if(p) total += p.sellPrice * qty;
    });
    document.getElementById('ord-total').textContent = 'Сума: '+fmt(total)+' грн';
  }
  
  function saveOrder() {
    var db = getDB();
    var items = [];
    document.querySelectorAll('#ord-items .form-row').forEach(function(row) {
      var prodId = row.querySelector('.ord-prod').value;
      var qty = parseInt(row.querySelector('.ord-qty').value)||0;
      var p = db.products.find(function(x){return x.id===prodId});
      if(p && qty>0) {
        items.push({productId:prodId, name:p.name, sku:p.sku||'', qty:qty, price:p.sellPrice});
      }
    });
    if(items.length===0) return alert('Додайте товари');
    // Stock not deducted at creation — only on shipping (shipOrderFromStock)
    var total = items.reduce(function(s,i){return s+i.qty*i.price},0);
    var firstStatus = (db.orderStatuses && db.orderStatuses.length) ? db.orderStatuses[0].id : 'new';
    var firstName = (v('ord-first-name')||'').trim();
    var lastName = (v('ord-last-name')||'').trim();
    var client = (firstName + ' ' + lastName).trim();
    db.orders.push({
      id:uid(), num:db.nextOrderNum++,
      date:v('ord-date')||new Date().toISOString().slice(0,10),
      firstName:firstName, lastName:lastName,
      client:client,
      phone:(v('ord-phone')||'').trim(),
      email:(v('ord-email')||'').trim(),
      carrier:v('ord-carrier')||'',
      city:(v('ord-city')||'').trim(),
      warehouse:(v('ord-warehouse')||'').trim(),
      address:(v('ord-address')||'').trim(),
      ttn:(v('ord-ttn')||'').trim(),
      shippingCost: parseFloat(v('ord-shipping-cost'))||0,
      paymentType:v('ord-payment')||'',
      paymentStatus:v('ord-payment-status')||'unpaid',
      comment:(v('ord-comment')||'').trim(),
      channel:v('ord-channel'),
      items:items, total:total, status:firstStatus
    });
    saveDB(db);
    closeModal('add-order');
    renderPage('orders');
  }
  
  // statusMeansReturn — винесено в public/js/returns.js
  
  function setOrderStatus(id, status) {
    var db = getDB();
    var ord = db.orders.find(function(x){return x.id===id});
    if(!ord) return;
    var prevStatus = ord.status;
    if (prevStatus === status) return; // no-op
    ord.status = status;
    // Автоматично відмічаємо оплату при статусі "Виконано"
    if (status === 'completed' && ord.paymentStatus !== 'paid') {
      ord.paymentStatus = 'paid';
    }
    logAudit(db, 'order', ord.id, 'status_change', { num: ord.num, from: prevStatus, to: status, client: ord.client });
    saveDB(db);
    // Auto-return: якщо новий статус означає повернення/відмову І ще не повертали
    var statuses = (db.orderStatuses || getOrderStatuses());
    var newStatusObj = statuses.find(function(s){return s.id===status;});
    var prevStatusObj = statuses.find(function(s){return s.id===prevStatus;});
    if (newStatusObj && statusMeansReturn(newStatusObj) && !statusMeansReturn(prevStatusObj) && !ord.returnedToStock) {
      // Викликаємо інтерактивний flow (запитає причину + покаже що відбудеться)
      setTimeout(function(){ returnOrderToStock(id); }, 50);
    } else {
      renderPage('orders');
    }
  }
  
  function setOrderWorker(id, worker) {
    var db = getDB();
    var ord = db.orders.find(function(x){return x.id===id});
    if(!ord) return;
    ord.worker = worker;
    // Майстер на замовленні — лише інформація про виконавця + вказівник на склад
    // для відвантаження. ЗП НЕ нараховується автоматично (платимо за виробництвом
    // наперед, тут просто відвантажуємо готову гру). Див. shipOrderFromStock.
    saveDB(db);
    // Re-render orders to refresh stock-source hint
    try { if (document.getElementById('orders') && document.getElementById('orders').classList.contains('active')) renderOrders(); } catch(e){}
  }
  
  // For each item in the order, keep exactly one completed production entry tagged as
  // source:'order-auto' with the current assigned worker. Removes stale entries if
  // worker changed or was unassigned. This makes the ЗП tab pick up orders automatically.
  function syncOrderAutoProduction(db, ord) {
    if (!db.production) db.production = [];
    // Remove previous auto entries for this order
    db.production = db.production.filter(function(b){ return !(b.source === 'order-auto' && b.orderId === ord.id); });
    if (!ord.worker) return;
    var today = new Date().toISOString().slice(0,10);
    (ord.items || []).forEach(function(it){
      if (!it.productId) return; // cannot calc salary without product link
      var qty = it.qty || 1;
      db.production.push({
        id: uid(),
        productId: it.productId,
        qty: qty,
        worker: ord.worker,
        date: ord.date || today,
        status: 'completed',
        completedQty: qty,
        completedDate: ord.date || today,
        source: 'order-auto',
        orderId: ord.id
      });
    });
  }
  
  // ==================== ORDER CHANNELS ====================
  // Channels — винесено в public/js/channels.js
  
  
  // inlineEdit*, setOrderPayment* — винесено в public/js/order-actions.js
  
  
  // ==================== SHIP ORDER FROM STOCK ====================
  // → винесено в public/js/order-shipping.js (planOrderShipment, orderStockHint,
  //   gatherShipmentSources, shipOrderFromStock, openPickShipmentModal,
  //   renderPickShipmentBody, goToShortageFromPickShipment, updatePickQty,
  //   confirmPickShipment, unshipOrder*, window._pickShipmentCtx)
  
  
  
  // ==================== FULFILLMENT ====================
  // → винесено в public/js/fulfillment.js (openTransferFulfillment, transferToFulfillment,
  //   returnFromFulfillment, toggleFfManager, applyFfManagerState, renderFulfillmentLocations,
  //   addFfLocation, renameFfLocation, deleteFfLocation)
  
  
  // ==================== ORDER STATUSES ====================
  // → винесено в public/js/statuses.js (getOrderStatuses, toggleStatusManager,
  //   renderStatusManager, addOrderStatus, renameStatus, updateStatusColor,
  //   moveStatus, deleteStatus)
  
  
  
  // Toggle warehouse vs address field based on carrier
  function toggleOrdDeliveryFields(prefix) {
    prefix = prefix || 'ord';
    var carrier = document.getElementById(prefix+'-carrier');
    if (!carrier) return;
    var val = carrier.value;
    var whWrap = document.getElementById(prefix+'-warehouse-wrap');
    var addrWrap = document.getElementById(prefix+'-address-wrap');
    if (!whWrap || !addrWrap) return;
    // Warehouse fields apply to: Нова Пошта, Укрпошта, Meest (branch pickup)
    // Address fields apply to: courier, other
    // Pickup has no delivery fields
    if (val === 'courier' || val === 'other') {
      whWrap.style.display = 'none';
      addrWrap.style.display = '';
    } else if (val === 'pickup' || val === '') {
      whWrap.style.display = '';
      addrWrap.style.display = 'none';
    } else {
      // nova / ukrposhta / meest
      whWrap.style.display = '';
      addrWrap.style.display = 'none';
    }
  }
  
  // Human-readable delivery/payment labels for display
  var ORD_CARRIER_LABELS = {
    nova:'📦 Нова Пошта', ukrposhta:'📮 Укрпошта', meest:'🚚 Meest',
    courier:'🛵 Курʼєр', pickup:'🏠 Самовивіз', other:'Інше'
  };
  var ORD_PAYMENT_LABELS = {
    cod:'📦 Післяплата', prepayment:'💳 Передоплата', iban:'🏦 IBAN',
    cash:'💵 Готівкою', other:'Інше'
  };
  var ORD_PAY_STATUS_LABELS = { unpaid:'Не оплачено', partial:'Часткова', paid:'✔ Оплачено' };
  
  function orderDeliverySummary(o) {
    if (!o) return '';
    // For workers hide destination details — only show carrier
    if (isCurrentUserWorker()) {
      return o.carrier ? (ORD_CARRIER_LABELS[o.carrier] || o.carrier) : '';
    }
    var parts = [];
    if (o.carrier) parts.push(ORD_CARRIER_LABELS[o.carrier] || o.carrier);
    if (o.city) parts.push(esc(o.city));
    if (o.warehouse) parts.push('№'+esc(String(o.warehouse).replace(/^№/,'')));
    if (o.address && !o.warehouse) parts.push(esc(o.address));
    if (o.shippingCost > 0) parts.push('<span style="color:#E65100;" title="Витрати на доставку — враховано в P&amp;L">💸 '+fmt(o.shippingCost)+' ₴</span>');
    return parts.join(', ');
  }
  
  // openEditOrder + saveOrderEdit + items editor — винесено в public/js/orders-modal.js
  
  
  // ==================== ORDER COLUMN SETTINGS ====================
  // → винесено в public/js/ord-cols.js (_defaultOrdCols, calcOrderProfit, getOrdCols,
  //   saveOrdCols, toggleOrdColSettings, renderOrdColSettings, ordColDrag*,
  //   toggleOrdCol, moveOrdCol, saveOrdColSettings, resetOrdCols)
  
  
  // Pagination + sort — винесено в public/js/pagination.js (window._ordPage, _ordSortCol, _ordSortDir)
  
  function exportOrdersCsv() {
    var db = getDB();
    var count = db.orders.length;
    if (!confirm('Експортувати '+count+' замовлень у CSV файл?')) return;
    var orders = db.orders.slice().sort(function(a,b){ return (b.date||'').localeCompare(a.date||''); });
    var header = ['#','Дата','Клієнт','Телефон','Товари','Сума','Статус','Канал','Оплата','ТТН','Майстер','Нотатка'];
    var rows = orders.map(function(o) {
      var items = (o.items||[]).map(function(i){return (i.name||'')+'x'+i.qty}).join('; ');
      return [o.num, o.date, o.client||((o.firstName||'')+' '+(o.lastName||'')).trim(), o.phone||'', items, o.total||0, o.status||'', o.channel||'', (o.paymentType||'')+' '+(o.paymentStatus||''), o.ttn||'', o.worker||'', o.note||''];
    });
    var csv = '\uFEFF' + [header].concat(rows).map(function(r){ return r.map(function(c){ return '"'+String(c).replace(/"/g,'""')+'"'; }).join(';'); }).join('\n');
    var blob = new Blob([csv], {type:'text/csv;charset=utf-8;'});
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'orders_'+new Date().toISOString().slice(0,10)+'.csv';
    a.click();
  }
  
  
  function renderOrders() {
    initSyncDateInput();
    // Фонове оновлення трекінгу НП (не частіше 1/10хв на сесію, не блокує рендер)
    try { maybeAutoRefreshNpTracking(); } catch(e){}
    var db = getDB();
    var tb = document.getElementById('orders-table');
    var statusFilter = document.getElementById('ord-status-filter').value;
    var channelFilter = document.getElementById('ord-channel-filter').value;
    var crmOnly = document.getElementById('ord-crm-only').checked;
    // Reset page if filters changed (tracked via signature)
    var searchQ = (document.getElementById('ord-search') ? document.getElementById('ord-search').value || '' : '').trim().toLowerCase();
    var dateFrom = document.getElementById('ord-date-from') ? document.getElementById('ord-date-from').value : '';
    var dateTo = document.getElementById('ord-date-to') ? document.getElementById('ord-date-to').value : '';
    var filterSig = statusFilter + '|' + channelFilter + '|' + (crmOnly?'1':'0') + '|' + searchQ + '|' + dateFrom + '|' + dateTo;
    if (renderOrders._lastSig && renderOrders._lastSig !== filterSig) _ordPage = 1;
    renderOrders._lastSig = filterSig;
    var statuses = db.orderStatuses || [{id:'new',label:'🆕 Новий',color:'#ffeaa7'},{id:'in_production',label:'🔧 На виробництві',color:'#81ecec'},{id:'completed',label:'✔ Виконано',color:'#55efc4'}];
    var statusMap = {};
    var statusColors = {};
    statuses.forEach(function(s){ statusMap[s.id] = s.label; statusColors[s.id] = s.color; });
  
    // Populate status filter dynamically
    var stFilterEl = document.getElementById('ord-status-filter');
    var curStFilter = stFilterEl.value;
    stFilterEl.innerHTML = '<option value="">Всі статуси</option>' + statuses.map(function(s){ return '<option value="'+s.id+'" '+(curStFilter===s.id?'selected':'')+'>'+esc(s.label)+'</option>'; }).join('');
  
    // Populate channel filter
    var channels = db.orderChannels || [];
    var chFilterEl = document.getElementById('ord-channel-filter');
    var curChFilter = chFilterEl.value;
    chFilterEl.innerHTML = '<option value="">Всі канали</option>' + channels.map(function(ch){ return '<option value="'+esc(ch)+'" '+(curChFilter===ch?'selected':'')+'>'+esc(ch)+'</option>'; }).join('');
  
    var filtered = db.orders.slice().sort(function(a,b) {
      var dir = _ordSortDir === 'asc' ? 1 : -1;
      switch(_ordSortCol) {
        case 'date': return dir * ((a.date||'').localeCompare(b.date||'') || a.num - b.num);
        case 'total': return dir * ((Number(a.total)||0) - (Number(b.total)||0));
        case 'client': return dir * ((a.client||a.firstName||'').localeCompare(b.client||b.firstName||''));
        case 'status': return dir * ((a.status||'').localeCompare(b.status||''));
        case 'ttn': return dir * ((a.ttn||'').localeCompare(b.ttn||''));
        default: return dir * ((b.date||'').localeCompare(a.date||'') || b.num - a.num);
      }
    }).filter(function(o) {
      if(statusFilter && o.status!==statusFilter) return false;
      if(channelFilter && (o.channel||'')!==channelFilter) return false;
      if(crmOnly && !o.crmId) return false;
      // Worker sees ONLY orders explicitly assigned to her (unassigned hidden too)
      if (isCurrentUserWorker()) {
        var myNames = getCurrentWorkerAliases().map(function(n){return (n||'').trim().toLowerCase();});
        var ow = (o.worker||'').trim().toLowerCase();
        if (myNames.indexOf(ow) === -1) return false;
      }
      return true;
    });
    if (searchQ) {
      filtered = filtered.filter(function(o) {
        return (o.client||'').toLowerCase().indexOf(searchQ) !== -1
          || ((o.firstName||'')+' '+(o.lastName||'')).toLowerCase().indexOf(searchQ) !== -1
          || (o.phone||'').indexOf(searchQ) !== -1
          || (o.ttn||'').indexOf(searchQ) !== -1
          || String(o.num).indexOf(searchQ) !== -1;
      });
    }
    if (dateFrom) filtered = filtered.filter(function(o){ return (o.date||'') >= dateFrom; });
    if (dateTo) filtered = filtered.filter(function(o){ return (o.date||'') <= dateTo; });
  
    // Pagination slice
    var pageSize = getOrdPageSize();
    var totalFiltered = filtered.length;
    var pageCount = pageSize === 'all' ? 1 : Math.max(1, Math.ceil(totalFiltered / pageSize));
    if (_ordPage > pageCount) _ordPage = pageCount;
    var pageStart = pageSize === 'all' ? 0 : (_ordPage - 1) * pageSize;
    var pageEnd = pageSize === 'all' ? totalFiltered : Math.min(totalFiltered, pageStart + pageSize);
    var pageItems = pageSize === 'all' ? filtered : filtered.slice(pageStart, pageEnd);
  
    // Total sum across the filtered set (not just current page)
    var totalSum = filtered.reduce(function(s, o){ return s + (Number(o.total)||0); }, 0);
    var sumStr = fmt(totalSum) + ' грн';
    var paidCount = filtered.filter(function(o){ return o.paymentStatus === 'paid'; }).length;
    var paidSum = filtered.filter(function(o){ return o.paymentStatus === 'paid'; }).reduce(function(s,o){ return s + (Number(o.total)||0); }, 0);
    document.getElementById('ord-count').innerHTML = totalFiltered
      ? 'Показано: '+(pageStart+1)+'–'+pageEnd+' з '+totalFiltered+
        (totalFiltered!==db.orders.length?' (всього '+db.orders.length+')':'')+
        ' &nbsp;•&nbsp; <strong style="color:var(--primary);">'+sumStr+'</strong>'+
        ' &nbsp;•&nbsp; <span style="color:var(--success);">✅ Оплачено: '+paidCount+' ('+fmt(paidSum)+' грн)</span>'
      : 'Показано: 0 з '+db.orders.length;
  
    // Column config
    var ordCols = getOrdCols();
    // Колонки для власника (наприклад, прибуток) майстер не бачить
    if (isCurrentUserWorker()) {
      ordCols = ordCols.filter(function(c){
        var def = _defaultOrdCols.find(function(d){ return d.id === c.id; });
        return !(def && def.ownerOnly);
      });
    }
    var visOrdCols = ordCols.filter(function(c){return c.visible;});
  
    // Render thead
    var thead = document.getElementById('orders-thead');
    thead.innerHTML = '<th>#</th>' + visOrdCols.map(function(c){
      var arrow = _ordSortCol === c.id ? (_ordSortDir === 'asc' ? ' ↑' : ' ↓') : '';
      return '<th style="cursor:pointer;user-select:none;" onclick="toggleOrdSort(\''+c.id+'\')">'+c.label+arrow+'</th>';
    }).join('') + '<th>Дії</th>';
  
    var channelOpts = '<option value="">—</option>' + channels.map(function(ch){ return '<option value="'+esc(ch)+'">'+esc(ch)+'</option>'; }).join('');
  
    // Cell renderer
    function ordCell(colId, o, statusOpts, statusColors, workerOpts, chSelectOpts, chColor, itemsStr) {
      switch(colId) {
        case 'status': return '<td data-label="Статус" style="min-width:130px;"><select onchange="setOrderStatus(\''+o.id+'\',this.value)" style="padding:4px 22px 4px 8px;border-radius:6px;font-size:12px;background:'+(statusColors[o.status]||'#fff')+';width:100%;min-width:110px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;box-sizing:border-box;">'+statusOpts+'</select></td>';
        case 'date': return '<td data-label="Дата">'+o.date+'</td>';
        case 'client': {
          if (isCurrentUserWorker()) {
            return '<td data-label="Клієнт"><span class="text-muted">Замовлення #'+o.num+'</span></td>';
          }
          var cname = o.client || ((o.firstName||'') + ' ' + (o.lastName||'')).trim() || '—';
          return '<td data-label="Клієнт">'+esc(cname)+(o.phone?'<br><a href="tel:'+esc(o.phone)+'" style="font-size:11px;color:var(--text-light);">'+esc(o.phone)+'</a>':'')+'</td>';
        }
        case 'phone': {
          if (isCurrentUserWorker()) return '<td data-label="Телефон"><span class="text-muted">—</span></td>';
          return '<td data-label="Телефон">'+(o.phone?'<a href="tel:'+esc(o.phone)+'" style="font-size:12px;">'+esc(o.phone)+'</a>':'<span class="text-muted">—</span>')+'</td>';
        }
        case 'items': {
          var extra = '';
          // Показати звідки списано (якщо вже відправлено)
          if (o.shipped && Array.isArray(o.shippedFrom) && o.shippedFrom.length) {
            var srcMap = {};
            o.shippedFrom.forEach(function(s){
              var key = s.source==='main' ? '📦 Склад'
                      : s.source==='worker' ? '👷 '+(wLabel(s.worker)||'майстер')
                      : s.source==='fulfillment' ? '🏬 '+s.location
                      : s.source;
              srcMap[key] = (srcMap[key]||0) + (s.qty||0);
            });
            var srcParts = Object.keys(srcMap).map(function(k){ return k+' −'+srcMap[k]; });
            extra += '<div style="font-size:10px;color:#2E7D32;margin-top:4px;">📤 '+srcParts.join(' • ')+'</div>';
          }
          // Підказка для позицій без прив'язки до товару
          var unlinked = (o.items||[]).filter(function(i){ return !i.productId; });
          if (unlinked.length && !o.shipped) {
            extra += '<div style="font-size:10px;color:#C62828;margin-top:4px;cursor:pointer;" onclick="openEditOrder(\''+o.id+'\')" title="Натисни щоб привʼязати товар">⚠ '+unlinked.length+' позиц. без товару — клікни ✏️</div>';
          }
          return '<td data-label="Товари">'+itemsStr+extra+'</td>';
        }
        case 'total': return '<td data-label="Сума">'+fmt(o.total)+' грн</td>';
        case 'profit': {
          var pp = calcOrderProfit(o, db);
          var color = pp.profit >= 0 ? 'var(--success)' : 'var(--danger)';
          var tipLines = [
            'Виручка: '+fmt(pp.revenue)+' грн',
            '− Матеріали (з друком/пакуванням): '+fmt(pp.materials)+' грн',
            '− Робота майстра: '+fmt(pp.work)+' грн'
          ];
          if (pp.shipping > 0) tipLines.push('− Доставка: '+fmt(pp.shipping)+' грн');
          tipLines.push('= Прибуток: '+fmt(pp.profit)+' грн');
          if (pp.unknown) tipLines.push('⚠ '+pp.unknown+' позиц. без привʼязки до товару — собівартість недооцінена');
          var tip = tipLines.join('\n');
          var warn = pp.unknown ? ' <span style="color:#E65100;" title="Є позиції без товару — собівартість неповна">⚠</span>' : '';
          return '<td data-label="Прибуток" title="'+esc(tip)+'" style="white-space:nowrap;color:'+color+';font-weight:600;">'+fmt(pp.profit)+' грн'+warn+'</td>';
        }
        case 'payment': {
          var currentType = o.paymentType || '';
          var currentStatus = o.paymentStatus || 'unpaid';
          var psColor = currentStatus==='paid' ? '#E8F5E9' : (currentStatus==='partial' ? '#FFF3E0' : '#FFEBEE');
          var psBorder = currentStatus==='paid' ? '#A5D6A7' : (currentStatus==='partial' ? '#FFCC80' : '#EF9A9A');
          var typeOpts = '<option value="">—</option>' +
            Object.keys(ORD_PAYMENT_LABELS).map(function(k){ return '<option value="'+k+'" '+(currentType===k?'selected':'')+'>'+esc(ORD_PAYMENT_LABELS[k])+'</option>'; }).join('');
          var statusOpts2 = Object.keys(ORD_PAY_STATUS_LABELS).map(function(k){ return '<option value="'+k+'" '+(currentStatus===k?'selected':'')+'>'+esc(ORD_PAY_STATUS_LABELS[k])+'</option>'; }).join('');
          return '<td data-label="Оплата" style="font-size:12px;min-width:160px;">'+
            '<select onchange="setOrderPaymentType(\''+o.id+'\',this.value)" style="padding:4px 6px;border-radius:6px;font-size:12px;width:100%;margin-bottom:4px;border:1px solid var(--border);box-sizing:border-box;">'+typeOpts+'</select>'+
            '<select onchange="setOrderPaymentStatus(\''+o.id+'\',this.value)" style="padding:4px 6px;border-radius:6px;font-size:12px;width:100%;background:'+psColor+';border:1px solid '+psBorder+';font-weight:600;box-sizing:border-box;">'+statusOpts2+'</select>'+
          '</td>';
        }
        case 'delivery': {
          var sum = orderDeliverySummary(o);
          return '<td data-label="Доставка" style="font-size:12px;">'+(sum||'<span class="text-muted">—</span>')+'</td>';
        }
        case 'ttn': {
          var ttnVal = o.ttn || '';
          var ttnDisplay = '';
          if (ttnVal) {
            ttnDisplay = '<span style="font-family:monospace;font-size:12px;">'+esc(ttnVal)+'</span>';
            var tr = o.tracking;
            if (tr && tr.statusCode) {
              var vis = statusToVisualNP(tr.statusCode);
              var label = vis ? (vis.emoji+' '+vis.label) : ('📍 '+esc(String(tr.status||'').slice(0,30)));
              var bgc = vis ? vis.bg : '#F5F5F5';
              var col = vis ? vis.color : '#616161';
              var tip = String(tr.status||'');
              if (tr.cityRecipient) tip += ' — ' + tr.cityRecipient + (tr.warehouseRecipient ? ', '+tr.warehouseRecipient : '');
              if (tr.actualDeliveryDate) tip += ' • Вручено: '+tr.actualDeliveryDate;
              else if (tr.scheduledDeliveryDate) tip += ' • Очік. доставка: '+tr.scheduledDeliveryDate;
              ttnDisplay += '<br><span style="display:inline-block;margin-top:3px;padding:2px 7px;font-size:10px;font-weight:600;border-radius:4px;background:'+bgc+';color:'+col+';" title="'+esc(tip)+'">'+label+'</span>';
            }
          } else {
            ttnDisplay = '<span class="text-muted" style="cursor:pointer;" title="Клікніть щоб додати ТТН">+ ТТН</span>';
          }
          return '<td data-label="ТТН" style="cursor:pointer;min-width:130px;" onclick="inlineEditTtn(this,\''+o.id+'\',\''+esc(ttnVal)+'\')">'+ttnDisplay+'</td>';
        }
        case 'channel': return '<td data-label="Канал"><select onchange="setOrderChannel(\''+o.id+'\',this.value)" style="padding:3px 6px;border-radius:8px;font-size:11px;border:1px solid '+chColor.bg+';background:'+chColor.bg+';color:'+chColor.text+';font-weight:600;min-width:80px;">'+chSelectOpts+'</select></td>';
        case 'worker': {
          // Збираємо унікальних майстрів з позицій (short name через wLabel)
          var itemWorkers = (o.items||[]).map(function(it){ return it.worker||''; }).filter(Boolean);
          var uniqW = {};
          itemWorkers.forEach(function(w){ uniqW[wLabel(w)||w] = true; });
          var distinct = Object.keys(uniqW);
          if (isCurrentUserWorker()) {
            var label = distinct.length ? distinct.join(', ') : (wLabel(o.worker)||o.worker || '');
            return '<td data-label="Майстер">'+(label ? esc(label) : '<span class="text-muted">—</span>')+'</td>';
          }
          if (distinct.length >= 2) {
            return '<td data-label="Майстер"><div style="font-size:11px;line-height:1.4;cursor:pointer;" onclick="openEditOrder(\''+o.id+'\')" title="Редагувати майстрів по позиціях">👷 '+distinct.map(esc).join('<br>👷 ')+'</div></td>';
          }
          if (distinct.length === 1) {
            return '<td data-label="Майстер"><div style="font-size:12px;cursor:pointer;" onclick="openEditOrder(\''+o.id+'\')" title="Майстер з позицій. Клікни щоб змінити.">👷 '+esc(distinct[0])+'</div></td>';
          }
          return '<td data-label="Майстер"><select onchange="setOrderWorker(\''+o.id+'\',this.value)" style="padding:4px 8px;border-radius:6px;font-size:12px;width:100%;">'+workerOpts+'</select></td>';
        }
        case 'note': {
          var noteVal = o.note || '';
          var noteIcon = noteVal ? '📝' : '<span class="text-muted">+</span>';
          var notePreview = noteVal ? ' <span style="font-size:11px;color:var(--text-light);max-width:100px;overflow:hidden;text-overflow:ellipsis;display:inline-block;vertical-align:middle;white-space:nowrap;">'+esc(noteVal.slice(0,30))+'</span>' : '';
          return '<td data-label="Нотатка" style="cursor:pointer;min-width:60px;" onclick="inlineEditNote(this,\''+o.id+'\',\''+esc(noteVal.replace(/'/g,"\\'")).replace(/\n/g,'\\n')+'\')">'+noteIcon+notePreview+'</td>';
        }
        default: return '<td>—</td>';
      }
    }
  
    var isWorkerView = isCurrentUserWorker();
    tb.innerHTML = pageItems.map(function(o) {
      var itemsStr = o.items.map(function(i, idx){
        var pricePart = '';
        if (!isWorkerView) {
          var pVal = Number(i.price) || 0;
          pricePart = ' · <span class="ord-item-price" onclick="event.stopPropagation();inlineEditItemPrice(this,\''+o.id+'\','+idx+','+pVal+')" style="cursor:pointer;color:var(--primary);border-bottom:1px dashed var(--primary);font-weight:500;" title="Клікни щоб виправити ціну (напр. перерахунок з USD/EUR для Etsy)">'+fmt(pVal)+' грн</span>';
        }
        return '<span style="font-size:12px;">'+(i.sku?'<code>'+esc(i.sku)+'</code> ':'')+esc(i.name)+' ×'+i.qty+pricePart+'</span>';
      }).join('<br>');
      var statusOpts = Object.keys(statusMap).map(function(k){return '<option value="'+k+'" '+(o.status===k?'selected':'')+'>'+statusMap[k]+'</option>';}).join('');
      var workerOpts = '<option value="">— не призначено —</option>'+getAllWorkerNames().map(function(w){return '<option value="'+esc(w)+'" '+(o.worker===w?'selected':'')+'>'+esc(wLabel(w))+'</option>';}).join('');
      var chColor = getChannelColor(o.channel);
      var chSelectOpts = channelOpts.replace('value="'+esc(o.channel||'')+'"', 'value="'+esc(o.channel||'')+'" selected');
      var cells = visOrdCols.map(function(c){ return ordCell(c.id, o, statusOpts, statusColors, workerOpts, chSelectOpts, chColor, itemsStr); }).join('');
      var shipBtn;
      if (o.shipped) {
        shipBtn = '<button class="btn btn-outline btn-sm" onclick="unshipOrder(\''+o.id+'\')" title="Скасувати відправку (повернути на склад)" style="margin-right:4px;background:#E8F5E9;color:#2E7D32;border-color:#A5D6A7;">✅</button>';
      } else {
        shipBtn = '<button class="btn btn-primary btn-sm" onclick="shipOrderFromStock(\''+o.id+'\')" title="Списати зі складу (відправити)" style="margin-right:4px;">📤</button>';
      }
      var numBadges = '#'+o.num;
      if (o.crmId) numBadges += '<br><span class="badge badge-ok" style="font-size:9px;">CRM</span>';
      if (o.returnedToStock) numBadges += '<br><span class="badge" style="background:'+(o.returnAsDefect?'#FFCDD2':'#FFE0B2')+';color:'+(o.returnAsDefect?'#B71C1C':'#E65100')+';font-size:9px;" title="'+esc(o.returnReason||'')+(o.returnDate?' • '+o.returnDate:'')+'">'+(o.returnAsDefect?'🚫 БРАК':'↩ повернено')+'</span>';
      var currentStatusObj = (db.orderStatuses || getOrderStatuses()).find(function(s){return s.id===o.status;});
      var canReturn = currentStatusObj && statusMeansReturn(currentStatusObj) && !o.returnedToStock;
      return '<tr'+(o.shipped?' style="opacity:0.85;"':'')+(o.returnedToStock?' style="opacity:0.6;background:#FFF8F8;"':'')+'>'+
        '<td data-label="№">'+numBadges+'</td>'+
        cells+
        '<td data-label="Дії" style="white-space:nowrap;">'+
          shipBtn+
          (canReturn ? '<button class="btn btn-outline btn-sm" onclick="returnOrderToStock(\''+o.id+'\')" title="Повернути товар на склад / позначити брак" style="margin-right:4px;">📦↩</button>' : '')+
          '<button class="btn btn-outline btn-sm" onclick="openEditOrder(\''+o.id+'\')" title="Редагувати" style="margin-right:4px;">✏️</button>'+
          '<button class="btn btn-danger btn-sm" onclick="deleteOrder(\''+o.id+'\')" title="Видалити">&#x1F5D1;</button></td>'+
      '</tr>';
    }).join('') || '<tr><td colspan="'+(visOrdCols.length+2)+'" class="text-muted" style="text-align:center;padding:40px;">Замовлень поки немає</td></tr>';
  
    // Pagination controls
    renderOrdPagination(totalFiltered, pageSize, pageCount);
  
    // Also render channel & status managers
    renderChannelManager();
    if (document.getElementById('status-manager').style.display==='block') renderStatusManager();
    // Populate order modal channel dropdown
    populateOrderChannels();
  }
  
  
  function confirmOrder(id) {
    var db = getDB();
    var ord = db.orders.find(function(x){return x.id===id});
    if(!ord) return;
    // Check stock
    var shortage = [];
    for(var i=0;i<ord.items.length;i++) {
      var item = ord.items[i];
      var p = db.products.find(function(x){return x.id===item.productId});
      if(p && item.qty > (p.stock||0)) {
        shortage.push(p.name + ': потрібно '+item.qty+', є '+(p.stock||0));
      }
    }
    if(shortage.length > 0) {
      if(!confirm('Не вистачає на складі:\n'+shortage.join('\n')+'\n\nПідтвердити без списання?')) return;
    }
    // Deduct stock
    for(var i=0;i<ord.items.length;i++) {
      var item = ord.items[i];
      var p = db.products.find(function(x){return x.id===item.productId});
      if(p && (p.stock||0) >= item.qty) {
        p.stock -= item.qty;
      }
    }
    ord.status = 'confirmed';
    saveDB(db);
    renderPage('orders');
  }
  
  // returnOrderToStock — винесено в public/js/returns.js
  
  
  function deleteOrder(id) {
    if(!confirm('Видалити замовлення?')) return;
    var db = getDB();
    var ord = db.orders.find(function(x){return x.id===id});
    if (ord) logAudit(db, 'order', ord.id, 'delete', { num: ord.num, client: ord.client, total: ord.total });
    db.orders = db.orders.filter(function(x){return x.id!==id});
    // Also remove any auto-created ЗП entries linked to this order
    if (db.production) db.production = db.production.filter(function(b){ return !(b.source === 'order-auto' && b.orderId === id); });
    saveDB(db);
    renderPage('orders');
  }

  window.addOrderLine = addOrderLine;
  window.calcOrderTotal = calcOrderTotal;
  window.saveOrder = saveOrder;
  window.setOrderStatus = setOrderStatus;
  window.setOrderWorker = setOrderWorker;
  window.syncOrderAutoProduction = syncOrderAutoProduction;
  window.toggleOrdDeliveryFields = toggleOrdDeliveryFields;
  window.orderDeliverySummary = orderDeliverySummary;
  window.exportOrdersCsv = exportOrdersCsv;
  window.renderOrders = renderOrders;
  window.confirmOrder = confirmOrder;
  window.deleteOrder = deleteOrder;
})();
