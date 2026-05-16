// ============================================================
// LipoLand — Salary module
// ============================================================
// Розрахунок зарплати, FIFO-розподіл виплат по партіях, історія виплат.
// Глобали які використовуємо: getDB, saveDB, esc, fmt, uid, wLabel,
// _currentUser, logAudit, openModal, closeModal.

(function(){
  'use strict';

  function calcWorkerEarnings(db, workerName) {
    var completed = db.production.filter(function(x){return x.status==='completed' && x.worker===workerName});
    var total = 0;
    completed.forEach(function(b){
      var p = db.products.find(function(x){return x.id===b.productId});
      if (!p) return;
      var rType = p.workerRateType || (db.workerRateDefault||{}).type || 'percent';
      var rVal = p.workerRate || (db.workerRateDefault||{}).value || 25;
      var rate = rType==='percent' ? Math.round(p.sellPrice*rVal/100) : rVal;
      total += rate * (b.completedQty||b.qty);
    });
    return total;
  }

  function calcWorkerInProgress(db, workerName) {
    var active = db.production.filter(function(x){return x.status==='in_progress' && x.worker===workerName});
    var total = 0;
    active.forEach(function(b){
      var p = db.products.find(function(x){return x.id===b.productId});
      if (!p) return;
      var rType = p.workerRateType || (db.workerRateDefault||{}).type || 'percent';
      var rVal = p.workerRate || (db.workerRateDefault||{}).value || 25;
      var rate = rType==='percent' ? Math.round(p.sellPrice*rVal/100) : rVal;
      total += rate * b.qty;
    });
    return total;
  }

  function calcWorkerPaid(db, workerName) {
    return (db.salaryPayments||[]).filter(function(p){return p.worker===workerName}).reduce(function(s,p){return s+(p.amount||0)},0);
  }

  function renderSalary() {
    var db = getDB();
    var isW = window._currentUser && window._currentUser.isWorker;
    var wName = isW ? (window._currentUser.linkedWorkerName || '') : '';

    if (isW) {
      document.getElementById('salary-title').textContent = 'Моя зарплата';
      document.getElementById('salary-desc').textContent = 'Ваш заробіток на основі зданого виробництва.';
      document.getElementById('salary-filters').style.display = 'none';
      document.getElementById('salary-pay-btn').style.display = 'none';
      document.getElementById('pay-hist-worker-th').style.display = 'none';
      document.getElementById('pay-hist-actions-th').style.display = 'none';
    } else {
      document.getElementById('salary-title').textContent = 'Нарахування ЗП';
      document.getElementById('salary-desc').textContent = 'Автоматичний розрахунок зарплати майстрів на основі зданого виробництва та ставок.';
      document.getElementById('salary-filters').style.display = '';
      document.getElementById('salary-pay-btn').style.display = '';
      document.getElementById('pay-hist-worker-th').style.display = '';
      document.getElementById('pay-hist-actions-th').style.display = '';
    }

    var completed = db.production.filter(function(x){return x.status==='completed'});
    if (isW && wName) completed = completed.filter(function(b){return b.worker===wName});

    function batchEarned(b) {
      var p = db.products.find(function(x){return x.id===b.productId});
      if (!p) return 0;
      var rType = p.workerRateType || (db.workerRateDefault||{}).type || 'percent';
      var rVal = p.workerRate || (db.workerRateDefault||{}).value || 25;
      var rate = rType === 'percent' ? Math.round((p.sellPrice||0) * rVal / 100) : rVal;
      return rate * (b.completedQty || b.qty);
    }
    var paidIds = {};
    var workersOnCompleted = {};
    completed.forEach(function(b){ if(b.worker) workersOnCompleted[b.worker] = true; });
    Object.keys(workersOnCompleted).forEach(function(w){
      var workerPaid = calcWorkerPaid(db, w);
      if (workerPaid <= 0) return;
      var wBatches = completed
        .filter(function(b){ return b.worker === w; })
        .slice()
        .sort(function(a,b){
          var ad = a.completedDate || a.date || '';
          var bd = b.completedDate || b.date || '';
          if (ad !== bd) return ad.localeCompare(bd);
          return (a.id||'').localeCompare(b.id||'');
        });
      var cum = 0;
      for (var i = 0; i < wBatches.length; i++) {
        var earned = batchEarned(wBatches[i]);
        if (cum + earned <= workerPaid) {
          paidIds[wBatches[i].id] = true;
          cum += earned;
        } else {
          break;
        }
      }
    });
    var showPaidEl = document.getElementById('salary-show-paid');
    var showPaid = showPaidEl ? showPaidEl.checked : false;

    var filtered, filteredAll;
    if (!isW) {
      var workers = [];
      var wSet = {};
      completed.forEach(function(b){ if(!wSet[b.worker]){wSet[b.worker]=true;workers.push(b.worker);} });
      var selW = document.getElementById('salary-worker');
      var curW = selW.value;
      selW.innerHTML = '<option value="">Всі майстри</option>' + workers.map(function(w){return '<option value="'+esc(w)+'" '+(w===curW?'selected':'')+'>'+esc(wLabel(w))+'</option>';}).join('');
      var dateFrom = document.getElementById('salary-date-from').value;
      var dateTo = document.getElementById('salary-date-to').value;
      filtered = completed;
      if(dateFrom) filtered = filtered.filter(function(b){ return (b.completedDate||b.date) >= dateFrom; });
      if(dateTo) filtered = filtered.filter(function(b){ return (b.completedDate||b.date) <= dateTo; });
      if(curW) filtered = filtered.filter(function(b){return b.worker===curW});
      filteredAll = filtered;
      if(!showPaid) filtered = filtered.filter(function(b){ return !paidIds[b.id]; });
    } else {
      filtered = completed;
      filteredAll = filtered;
      if(!showPaid) filtered = filtered.filter(function(b){ return !paidIds[b.id]; });
    }

    var totalSalary = 0;
    var colCount = isW ? 5 : 7;
    var rows = filtered.map(function(b) {
      var p = db.products.find(function(x){return x.id===b.productId});
      var rate = 0;
      var rateLabel = '';
      if (p) {
        var rType = p.workerRateType || (db.workerRateDefault||{}).type || 'percent';
        var rVal = p.workerRate || (db.workerRateDefault||{}).value || 25;
        if (rType === 'percent') { rate = Math.round(p.sellPrice * rVal / 100); rateLabel = rVal+'%'; }
        else { rate = rVal; rateLabel = 'фікс.'; }
      }
      var earned = rate * (b.completedQty||b.qty);
      totalSalary += earned;
      var paidBadge = paidIds[b.id] ? ' <span class="badge" style="background:#E8F5E9;color:#2E7D32;border:1px solid #A5D6A7;font-size:10px;margin-left:6px;" title="Покрито виплатою (FIFO)">💸 виплачено</span>' : '';
      var rowStyle = paidIds[b.id] ? ' style="opacity:0.6;"' : '';
      if (isW) {
        return '<tr'+rowStyle+'><td data-label="Дата">'+(b.completedDate||b.date)+'</td><td data-label="Гра">'+(p?esc(p.name):'?')+paidBadge+'</td>'+
          '<td data-label="К-сть">'+(b.completedQty||b.qty)+'</td><td data-label="Ставка">'+fmt(rate)+' грн ('+rateLabel+')</td><td data-label="Нараховано"><strong>'+fmt(earned)+' грн</strong></td></tr>';
      }
      var dateVal = b.completedDate || b.date;
      return '<tr'+rowStyle+'><td data-label="Дата"><input type="date" value="'+dateVal+'" onchange="updateSalaryDate(\''+b.id+'\', this.value)" style="border:1px solid transparent;background:transparent;padding:4px 6px;border-radius:6px;font-size:13px;font-family:inherit;cursor:pointer;" onmouseover="this.style.borderColor=\'var(--border)\'" onmouseout="this.style.borderColor=\'transparent\'" title="Клікни щоб змінити дату здачі"></td><td data-label="Майстер">'+esc(wLabel(b.worker))+'</td><td data-label="Гра">'+(p?esc(p.name):'<span style="color:var(--danger);">? (гру видалено)</span>')+paidBadge+'</td>'+
        '<td data-label="К-сть">'+(b.completedQty||b.qty)+'</td><td data-label="Ставка">'+fmt(rate)+' грн ('+rateLabel+')</td><td data-label="Нараховано"><strong>'+fmt(earned)+' грн</strong></td>'+
        '<td data-label="Дії" style="white-space:nowrap;"><button class="btn btn-outline btn-sm" onclick="deleteSalaryRecord(\''+b.id+'\')" title="Видалити запис">🗑</button></td></tr>';
    });

    var thead = document.getElementById('salary-thead');
    if (isW) {
      thead.innerHTML = '<th>Дата</th><th>Гра</th><th>К-сть</th><th>Ставка</th><th>Нараховано</th>';
    } else {
      thead.innerHTML = '<th>Дата</th><th>Майстер</th><th>Гра</th><th>К-сть</th><th>Ставка</th><th>Нараховано</th><th style="width:60px;">Дії</th>';
    }

    var emptyMsg = 'Немає даних';
    if (!showPaid && Object.keys(paidIds).length > 0 && completed.length > 0) {
      emptyMsg = '✓ Всі нараховані партії в цьому фільтрі вже виплачені. Постав галочку «Показати виплачені» щоб побачити їх.';
    }
    document.getElementById('salary-table').innerHTML = rows.join('') || '<tr><td colspan="'+colCount+'" class="text-muted" style="text-align:center;padding:40px;">'+emptyMsg+'</td></tr>';

    var cardsHtml = '';
    if (isW && wName) {
      var totalEarned = calcWorkerEarnings(db, wName);
      var totalPaid = calcWorkerPaid(db, wName);
      var inProgress = calcWorkerInProgress(db, wName);
      var balance = totalEarned - totalPaid;
      cardsHtml += '<div class="card '+(balance>0?'warning':'success')+'"><div class="card-label">До виплати</div><div class="card-value">'+fmt(balance)+' <span style="font-size:16px;">грн</span></div></div>';
      cardsHtml += '<div class="card"><div class="card-label">В роботі</div><div class="card-value">'+fmt(inProgress)+' <span style="font-size:16px;">грн</span></div><div class="card-sub">очікується після здачі</div></div>';
      cardsHtml += '<div class="card success"><div class="card-label">Всього зароблено</div><div class="card-value">'+fmt(totalEarned)+' <span style="font-size:16px;">грн</span></div></div>';
      cardsHtml += '<div class="card"><div class="card-label">Виплачено</div><div class="card-value">'+fmt(totalPaid)+' <span style="font-size:16px;">грн</span></div></div>';
    } else {
      var byWorker = {};
      filteredAll.forEach(function(b) {
        var p = db.products.find(function(x){return x.id===b.productId});
        var sRate = 0;
        if (p) {
          var sType = p.workerRateType || (db.workerRateDefault||{}).type || 'percent';
          var sVal = p.workerRate || (db.workerRateDefault||{}).value || 25;
          sRate = sType==='percent' ? Math.round(p.sellPrice*sVal/100) : sVal;
        }
        var earned = sRate * (b.completedQty||b.qty);
        var pcs = b.completedQty||b.qty;
        if(!byWorker[b.worker]) byWorker[b.worker] = {earned:0, pcs:0, paid:0, balance:0};
        byWorker[b.worker].earned += earned;
        byWorker[b.worker].pcs += pcs;
      });
      Object.keys(byWorker).forEach(function(w){
        byWorker[w].paid = calcWorkerPaid(db, w);
        byWorker[w].balance = byWorker[w].earned - byWorker[w].paid;
        byWorker[w].inProgress = calcWorkerInProgress(db, w);
      });
      db.production.forEach(function(b){
        if (b.status==='in_progress' && b.worker && !byWorker[b.worker]) {
          byWorker[b.worker] = { earned:0, pcs:0, paid: calcWorkerPaid(db, b.worker), balance: 0, inProgress: calcWorkerInProgress(db, b.worker) };
          byWorker[b.worker].balance = -byWorker[b.worker].paid;
        }
      });
      var totalDebt = 0;
      Object.keys(byWorker).forEach(function(w){
        var d = byWorker[w];
        var fullyPaid = d.balance <= 0 && d.paid > 0;
        var bigNum = d.balance > 0 ? d.balance : 0;
        var bigColor = fullyPaid ? 'var(--success)' : (d.balance > 0 ? 'var(--warning)' : 'var(--text)');
        var bigLabel = fullyPaid ? '✓ Все виплачено' : (d.balance > 0 ? 'Борг до виплати' : 'Без нарахувань');
        totalDebt += Math.max(0, d.balance);
        cardsHtml += '<div class="card">'+
          '<div class="card-label">'+esc(wLabel(w))+'</div>'+
          '<div class="card-value" style="color:'+bigColor+';">'+(fullyPaid?'<span style="font-size:24px;">✓</span>':fmt(bigNum)+' <span style="font-size:16px;">грн</span>')+'</div>'+
          '<div class="card-sub" style="font-size:11px;line-height:1.5;">'+
            '<div>'+bigLabel+'</div>'+
            '<div style="color:var(--text-light);">Нараховано: '+fmt(d.earned)+' грн ('+d.pcs+' виробів)</div>'+
            (d.paid > 0 ? '<div style="color:var(--success);">Виплачено: '+fmt(d.paid)+' грн</div>' : '')+
            ((d.inProgress||0) > 0 ? '<div style="color:#1565C0;font-size:13px;font-weight:600;margin-top:6px;padding-top:6px;border-top:1px dashed var(--border);">🛠 В роботі: '+fmt(d.inProgress)+' грн<div style="font-size:10px;font-weight:400;color:var(--text-light);">нарахується після здачі</div></div>' : '')+
          '</div>'+
        '</div>';
      });
      var totalEarnedAll = 0;
      Object.keys(byWorker).forEach(function(w){ totalEarnedAll += byWorker[w].earned; });
      if(totalEarnedAll>0) {
        cardsHtml += '<div class="card success">'+
          '<div class="card-label">Загальний борг</div>'+
          '<div class="card-value">'+fmt(totalDebt)+' <span style="font-size:16px;">грн</span></div>'+
          '<div class="card-sub" style="font-size:11px;color:var(--text-light);">Нараховано всього: '+fmt(totalEarnedAll)+' грн</div>'+
        '</div>';
      }
    }
    document.getElementById('salary-cards').innerHTML = cardsHtml;

    renderSalaryPayments(db, isW, wName);
  }

  function setSalaryDateRange(preset) {
    var from = document.getElementById('salary-date-from');
    var to = document.getElementById('salary-date-to');
    var today = new Date();
    var day = today.getDay();
    var mondayOffset = day === 0 ? -6 : 1 - day;
    if (preset === 'thisWeek') {
      var monday = new Date(today);
      monday.setDate(today.getDate() + mondayOffset);
      var sunday = new Date(monday);
      sunday.setDate(monday.getDate() + 6);
      from.value = monday.toISOString().slice(0,10);
      to.value = sunday.toISOString().slice(0,10);
    } else if (preset === 'lastWeek') {
      var monday2 = new Date(today);
      monday2.setDate(today.getDate() + mondayOffset - 7);
      var sunday2 = new Date(monday2);
      sunday2.setDate(monday2.getDate() + 6);
      from.value = monday2.toISOString().slice(0,10);
      to.value = sunday2.toISOString().slice(0,10);
    } else if (preset === 'thisMonth') {
      var y = today.getFullYear();
      var m = ('0'+(today.getMonth()+1)).slice(-2);
      from.value = y+'-'+m+'-01';
      to.value = today.toISOString().slice(0,10);
    } else {
      from.value = '';
      to.value = '';
    }
    renderSalary();
  }

  function deleteSalaryRecord(batchId) {
    if (!confirm('Видалити цей запис із нарахувань ЗП?\n\n(Запис виробництва також буде видалено)')) return;
    var db = getDB();
    db.production = db.production.filter(function(x){ return x.id !== batchId; });
    saveDB(db);
    renderSalary();
  }

  function updateSalaryDate(batchId, newDate) {
    if (!newDate) return;
    var db = getDB();
    var b = db.production.find(function(x){ return x.id === batchId; });
    if (!b) return;
    b.completedDate = newDate;
    saveDB(db);
    renderSalary();
  }

  var _editingSalaryId = null;

  function computePaymentBreakdown(db) {
    var result = {};
    var byWorkerPay = {};
    (db.salaryPayments||[]).forEach(function(p){
      if (!byWorkerPay[p.worker]) byWorkerPay[p.worker] = [];
      byWorkerPay[p.worker].push(p);
    });
    function batchEarnedAmount(b) {
      var p = db.products.find(function(x){return x.id===b.productId});
      if (!p) return 0;
      var rType = p.workerRateType || (db.workerRateDefault||{}).type || 'percent';
      var rVal = p.workerRate || (db.workerRateDefault||{}).value || 25;
      var rate = rType === 'percent' ? Math.round((p.sellPrice||0) * rVal / 100) : rVal;
      return rate * (b.completedQty || b.qty);
    }
    Object.keys(byWorkerPay).forEach(function(w){
      var payments = byWorkerPay[w].slice().sort(function(a,b){
        var ad = a.date||''; var bd = b.date||'';
        if (ad !== bd) return ad.localeCompare(bd);
        return (a.id||'').localeCompare(b.id||'');
      });
      var batches = (db.production||[])
        .filter(function(b){ return b.status==='completed' && b.worker===w; })
        .slice()
        .sort(function(a,b){
          var ad = a.completedDate || a.date || '';
          var bd = b.completedDate || b.date || '';
          if (ad !== bd) return ad.localeCompare(bd);
          return (a.id||'').localeCompare(b.id||'');
        });
      var bIdx = 0;
      var bRemaining = batches.length ? batchEarnedAmount(batches[0]) : 0;
      payments.forEach(function(pay){
        result[pay.id] = [];
        var payRemaining = Number(pay.amount) || 0;
        while (payRemaining > 0 && bIdx < batches.length) {
          if (bRemaining <= 0) {
            bIdx++;
            if (bIdx >= batches.length) break;
            bRemaining = batchEarnedAmount(batches[bIdx]);
            continue;
          }
          var b = batches[bIdx];
          var bTotal = batchEarnedAmount(b);
          var take = Math.min(payRemaining, bRemaining);
          var prod = db.products.find(function(x){return x.id===b.productId});
          result[pay.id].push({
            batchId: b.id,
            sku: prod ? (prod.sku||'') : '',
            name: prod ? prod.name : '? (гру видалено)',
            qty: b.completedQty || b.qty,
            date: b.completedDate || b.date,
            amount: take,
            batchTotal: bTotal,
            fullyCovered: take >= bRemaining
          });
          bRemaining -= take;
          payRemaining -= take;
        }
      });
    });
    return result;
  }

  function toggleSalaryPaymentDetail(payId) {
    var el = document.getElementById('sal-pay-det-'+payId);
    if (!el) return;
    el.style.display = el.style.display === 'none' ? '' : 'none';
  }

  function renderSalaryPayments(db, isW, wName) {
    var payments = (db.salaryPayments||[]).slice().sort(function(a,b){return (b.date||'').localeCompare(a.date||'')});
    if (isW && wName) payments = payments.filter(function(p){return p.worker===wName});

    var breakdown = computePaymentBreakdown(db);
    var colspan = isW ? 4 : 6;

    document.getElementById('salary-payments-table').innerHTML = payments.map(function(p){
      var workerTd = isW ? '' : '<td data-label="Майстер">'+esc(wLabel(p.worker))+'</td>';
      var actionsTd = isW ? '' : '<td><button class="btn btn-outline btn-sm" title="Редагувати" onclick="openPaySalaryModal(\''+p.id+'\')" style="margin-right:4px;">✏️</button><button class="btn btn-danger btn-sm" title="Видалити" onclick="deleteSalaryPayment(\''+p.id+'\')">🗑</button></td>';

      var items = breakdown[p.id] || [];
      var totalCovered = items.reduce(function(s,x){return s+x.amount;}, 0);
      var unallocated = Math.max(0, (Number(p.amount)||0) - totalCovered);
      var btnLabel = items.length ? '📋 '+items.length+' '+(items.length===1?'партія':items.length<5?'партії':'партій') : '— нема партій';
      var btnTitle = items.length ? 'Клікни щоб побачити перелік партій, які покрила ця виплата' : 'Партій для цієї виплати не знайдено (можливо аванс або виплата без виробництва)';
      var detailTd = '<td data-label="За що"><button class="btn btn-outline btn-sm" onclick="toggleSalaryPaymentDetail(\''+p.id+'\')" title="'+esc(btnTitle)+'" style="font-size:12px;padding:4px 10px;">'+btnLabel+'</button></td>';

      var rowHtml = '<tr><td data-label="Дата">'+esc(p.date)+'</td>'+workerTd+'<td data-label="Сума"><strong>'+fmt(p.amount)+' грн</strong></td><td data-label="Коментар">'+esc(p.note||'—')+'</td>'+detailTd+actionsTd+'</tr>';

      var detailInner = '';
      if (items.length) {
        detailInner = '<div style="padding:8px 0;">'+
          '<div style="font-size:12px;color:var(--text-light);margin-bottom:6px;">FIFO-розподіл: ця виплата покрила (від найстарішої партії):</div>'+
          '<table style="width:100%;font-size:12px;border-collapse:collapse;">'+
            '<thead><tr style="background:#F3E5F5;color:#4A148C;"><th style="padding:6px 8px;text-align:left;">Дата здачі</th><th style="padding:6px 8px;text-align:left;">Артикул</th><th style="padding:6px 8px;text-align:left;">Гра</th><th style="padding:6px 8px;text-align:center;">К-сть</th><th style="padding:6px 8px;text-align:right;">Покрито з виплати</th><th style="padding:6px 8px;text-align:center;">Статус</th></tr></thead>'+
            '<tbody>'+items.map(function(x){
              var statusBadge = x.fullyCovered
                ? '<span class="badge" style="background:#E8F5E9;color:#2E7D32;font-size:10px;">✓ повністю ('+fmt(x.batchTotal)+' грн)</span>'
                : '<span class="badge" style="background:#FFF3E0;color:#E65100;font-size:10px;" title="Решта '+fmt(x.batchTotal - x.amount)+' грн із цієї партії — наступна виплата">⚠ частково (з '+fmt(x.batchTotal)+' грн)</span>';
              return '<tr style="border-bottom:1px solid #F0F0F0;">'+
                '<td style="padding:6px 8px;">'+esc(x.date||'—')+'</td>'+
                '<td style="padding:6px 8px;"><code style="font-size:11px;">'+esc(x.sku||'—')+'</code></td>'+
                '<td style="padding:6px 8px;">'+esc(x.name)+'</td>'+
                '<td style="padding:6px 8px;text-align:center;">'+x.qty+'</td>'+
                '<td style="padding:6px 8px;text-align:right;font-weight:600;">'+fmt(x.amount)+' грн</td>'+
                '<td style="padding:6px 8px;text-align:center;">'+statusBadge+'</td>'+
              '</tr>';
            }).join('')+'</tbody>'+
            '<tfoot><tr style="border-top:2px solid #E1BEE7;font-weight:600;"><td colspan="4" style="padding:6px 8px;text-align:right;">Разом покрито:</td><td style="padding:6px 8px;text-align:right;color:#4A148C;">'+fmt(totalCovered)+' грн</td><td style="padding:6px 8px;text-align:center;">'+(unallocated>0?'<span class="text-muted" style="font-size:11px;">+'+fmt(unallocated)+' грн аванс</span>':'')+'</td></tr></tfoot>'+
          '</table>'+
        '</div>';
      } else {
        detailInner = '<div style="padding:8px 4px;color:var(--text-light);font-size:12px;">Для цієї виплати не знайдено зданих партій (можливо аванс наперед або виплата без виробництва).</div>';
      }
      var detailRow = '<tr id="sal-pay-det-'+p.id+'" style="display:none;background:#FAFAFE;"><td colspan="'+colspan+'" style="padding:8px 16px;">'+detailInner+'</td></tr>';

      return rowHtml + detailRow;
    }).join('') || '<tr><td colspan="'+colspan+'" class="text-muted" style="text-align:center;padding:30px;">Виплат ще не було</td></tr>';
  }

  function openPaySalaryModal(editId) {
    var db = getDB();
    _editingSalaryId = editId || null;
    window._editingSalaryId = _editingSalaryId;
    var editing = _editingSalaryId ? (db.salaryPayments||[]).find(function(p){return p.id===_editingSalaryId}) : null;

    var workers = [];
    var wSet = {};
    db.production.filter(function(x){return x.status==='completed'}).forEach(function(b){
      if(!wSet[b.worker]){wSet[b.worker]=true;workers.push(b.worker);}
    });
    (db.salaryPayments||[]).forEach(function(p){ if(!wSet[p.worker]){wSet[p.worker]=true;workers.push(p.worker);} });
    if (editing && !wSet[editing.worker]) { workers.push(editing.worker); wSet[editing.worker] = true; }

    document.getElementById('pay-salary-worker').innerHTML = workers.map(function(w){return '<option value="'+esc(w)+'">'+esc(wLabel(w))+'</option>';}).join('');

    var titleEl = document.querySelector('#modal-pay-salary .modal-header h3');
    var btnEl = document.querySelector('#modal-pay-salary .modal-actions .btn-primary');
    if (editing) {
      if (titleEl) titleEl.textContent = '✏️ Редагувати виплату';
      if (btnEl) btnEl.textContent = '💾 Зберегти';
      document.getElementById('pay-salary-worker').value = editing.worker;
      document.getElementById('pay-salary-amount').value = editing.amount;
      document.getElementById('pay-salary-note').value = editing.note || '';
      document.getElementById('pay-salary-date').value = editing.date || new Date().toISOString().slice(0,10);
      document.getElementById('pay-salary-hint').textContent = '';
    } else {
      if (titleEl) titleEl.textContent = '💸 Виплата зарплати';
      if (btnEl) btnEl.textContent = '💸 Виплатити';
      document.getElementById('pay-salary-amount').value = '';
      document.getElementById('pay-salary-note').value = '';
      document.getElementById('pay-salary-date').value = new Date().toISOString().slice(0,10);
      updatePaySalaryHint();
    }
    openModal('pay-salary');
  }

  function updatePaySalaryHint() {
    var db = getDB();
    var w = document.getElementById('pay-salary-worker').value;
    if (!w) { document.getElementById('pay-salary-hint').textContent = ''; return; }
    var earned = calcWorkerEarnings(db, w);
    var paid = calcWorkerPaid(db, w);
    var balance = earned - paid;
    document.getElementById('pay-salary-hint').innerHTML = 'Нараховано: '+fmt(earned)+' грн · Виплачено: '+fmt(paid)+' грн · <strong>Борг: '+fmt(balance)+' грн</strong>';
    document.getElementById('pay-salary-amount').value = balance > 0 ? balance : '';
  }

  function saveSalaryPayment() {
    var worker = document.getElementById('pay-salary-worker').value;
    var amount = parseFloat(document.getElementById('pay-salary-amount').value);
    var note = document.getElementById('pay-salary-note').value.trim();
    var date = document.getElementById('pay-salary-date').value;
    if (!worker || !amount || amount <= 0) { alert('Вкажіть майстра та суму'); return; }
    var db = getDB();
    if (!db.salaryPayments) db.salaryPayments = [];
    if (_editingSalaryId) {
      var existing = db.salaryPayments.find(function(p){return p.id===_editingSalaryId});
      if (existing) {
        if (typeof logAudit === 'function') logAudit(db, 'salary', existing.id, 'edit', { worker: worker, oldAmount: existing.amount, newAmount: amount, date: date, note: note });
        existing.worker = worker; existing.amount = amount; existing.note = note; existing.date = date;
      }
      _editingSalaryId = null;
      window._editingSalaryId = null;
    } else {
      var newId = uid();
      db.salaryPayments.push({ id:newId, worker:worker, amount:amount, note:note, date:date });
      if (typeof logAudit === 'function') logAudit(db, 'salary', newId, 'pay', { worker: worker, amount: amount, date: date, note: note });
    }
    saveDB(db);
    closeModal('pay-salary');
    renderSalary();
  }

  function deleteSalaryPayment(payId) {
    if (!confirm('Видалити цю виплату?')) return;
    var db = getDB();
    var p = (db.salaryPayments||[]).find(function(x){return x.id===payId});
    if (p && typeof logAudit === 'function') logAudit(db, 'salary', payId, 'delete', { worker: p.worker, amount: p.amount, date: p.date });
    db.salaryPayments = (db.salaryPayments||[]).filter(function(p){return p.id!==payId});
    saveDB(db);
    renderSalary();
  }

  // Експорт для inline і виклику з renderPage
  window.renderSalary = renderSalary;
  window.calcWorkerEarnings = calcWorkerEarnings;
  window.calcWorkerInProgress = calcWorkerInProgress;
  window.calcWorkerPaid = calcWorkerPaid;
  window.setSalaryDateRange = setSalaryDateRange;
  window.deleteSalaryRecord = deleteSalaryRecord;
  window.updateSalaryDate = updateSalaryDate;
  window.computePaymentBreakdown = computePaymentBreakdown;
  window.toggleSalaryPaymentDetail = toggleSalaryPaymentDetail;
  window.openPaySalaryModal = openPaySalaryModal;
  window.updatePaySalaryHint = updatePaySalaryHint;
  window.saveSalaryPayment = saveSalaryPayment;
  window.deleteSalaryPayment = deleteSalaryPayment;
})();
