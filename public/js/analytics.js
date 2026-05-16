// ============================================================
// LipoLand — Analytics module
// ============================================================
// renderAnalytics — P&L, місячна динаміка, топ-товари, канали продажу.
// setAnalyticsPeriod — пресети 3m/6m/12m/all. Інтегрує renderCosts (зі складу costs.js).

(function(){
  'use strict';

  // ==================== ANALYTICS ====================
  function setAnalyticsPeriod(period) {
    var now = new Date();
    var to = now.toISOString().slice(0,7);
    var from;
    if (period === '3m') { now.setMonth(now.getMonth()-2); from = now.toISOString().slice(0,7); }
    else if (period === '6m') { now.setMonth(now.getMonth()-5); from = now.toISOString().slice(0,7); }
    else if (period === '12m') { now.setMonth(now.getMonth()-11); from = now.toISOString().slice(0,7); }
    else { from = ''; }
    document.getElementById('an-from').value = from;
    document.getElementById('an-to').value = to;
    renderAnalytics();
  }
  
  function renderAnalytics() {
    var db = getDB();
    // Cost breakdown table (перенесено зі старої сторінки «Собівартість»)
    if (typeof renderCosts === 'function') {
      try { renderCosts(); } catch(e) { console.warn('renderCosts failed:', e); }
    }
    var fromMonth = document.getElementById('an-from').value;
    var toMonth = document.getElementById('an-to').value;
  
    // Filter orders by period
    var orders = db.orders.filter(function(o) {
      var m = (o.date||'').slice(0,7);
      if (fromMonth && m < fromMonth) return false;
      if (toMonth && m > toMonth) return false;
      return true;
    });
  
    // Group by month
    var months = {};
    orders.forEach(function(o) {
      var m = (o.date||'').slice(0,7);
      if (!m) return;
      if (!months[m]) months[m] = { orders:0, items:0, revenue:0, cost:0, salary:0 };
      months[m].orders++;
      (o.items||[]).forEach(function(item) {
        months[m].items += item.qty||0;
        months[m].revenue += (item.qty||0) * (item.price||0);
        // Calculate cost per item
        var p = db.products.find(function(x){return x.id===item.productId});
        if (p) {
          var c = calcCost(p, db.materials, db);
          months[m].cost += c.total * (item.qty||0);
          months[m].salary += c.work * (item.qty||0);
        }
      });
    });
  
    // Sort months
    var sortedMonths = Object.keys(months).sort();
  
    // ----- OpEx per month (from db.expenses) + Taxes per month -----
    // Collect all months we care about: from orders + from expenses in the period
    var expensesAll = (db.expenses || []).filter(function(e) {
      var m = (e.date||'').slice(0,7);
      if (fromMonth && m < fromMonth) return false;
      if (toMonth && m > toMonth) return false;
      return true;
    });
    // Union of months
    var monthSet = {};
    sortedMonths.forEach(function(m){ monthSet[m]=true; });
    expensesAll.forEach(function(e){ var m=(e.date||'').slice(0,7); if(m) monthSet[m]=true; });
    sortedMonths = Object.keys(monthSet).sort();
    sortedMonths.forEach(function(m) {
      if (!months[m]) months[m] = { orders:0, items:0, revenue:0, cost:0, salary:0 };
    });
  
    // Per-month OpEx breakdown
    var opexByMonth = {}; // m -> { total, byCat: {cat: sum} }
    expensesAll.forEach(function(e) {
      var m = (e.date||'').slice(0,7);
      if (!m) return;
      if (!opexByMonth[m]) opexByMonth[m] = { total:0, byCat:{} };
      opexByMonth[m].total += (e.amount||0);
      opexByMonth[m].byCat[e.category] = (opexByMonth[m].byCat[e.category]||0) + (e.amount||0);
    });
  
    // Shipping costs from orders (напр. доставка ETSY, яку платить власниця) →
    // окрема OpEx-категорія. Беремо по даті замовлення.
    var SHIP_CAT = '🚚 Доставка замовлень';
    (db.orders || []).forEach(function(ord){
      var cost = parseFloat(ord.shippingCost) || 0;
      if (cost <= 0) return;
      var m = (ord.date || '').slice(0,7);
      if (!m) return;
      if (fromMonth && m < fromMonth) return;
      if (toMonth && m > toMonth) return;
      if (!opexByMonth[m]) opexByMonth[m] = { total:0, byCat:{} };
      opexByMonth[m].total += cost;
      opexByMonth[m].byCat[SHIP_CAT] = (opexByMonth[m].byCat[SHIP_CAT]||0) + cost;
      monthSet[m] = true;
    });
    // Rebuild sortedMonths in case shipping costs introduced new months
    sortedMonths = Object.keys(monthSet).sort();
    sortedMonths.forEach(function(m) {
      if (!months[m]) months[m] = { orders:0, items:0, revenue:0, cost:0, salary:0 };
    });
  
    // Taxes per month
    var taxByMonth = {};
    sortedMonths.forEach(function(m) {
      var t = computeTaxForMonth(db, m, months[m].revenue);
      taxByMonth[m] = t;
    });
    // Exclude '🧾 Податки' category from OpEx if we're auto-computing (to avoid double count).
    // Rule: if user manually entered tax expense, treat that as override ⇒ skip auto.
    // Implementation: if opexByMonth[m].byCat['🧾 Податки'] > 0, use it as tax; else use computed.
    var finalTaxByMonth = {};
    sortedMonths.forEach(function(m) {
      var manualTax = (opexByMonth[m] && opexByMonth[m].byCat['🧾 Податки']) || 0;
      if (manualTax > 0) {
        finalTaxByMonth[m] = { amount: manualTax, source:'manual', label:'вручну з Витрат' };
        // Remove from OpEx total so it's not double-counted
        opexByMonth[m].total -= manualTax;
        delete opexByMonth[m].byCat['🧾 Податки'];
      } else {
        finalTaxByMonth[m] = taxByMonth[m];
      }
    });
  
    // Totals
    var totalRevenue = 0, totalCost = 0, totalSalary = 0, totalOrders = 0, totalItems = 0;
    var totalOpEx = 0, totalTax = 0;
    sortedMonths.forEach(function(m) {
      totalRevenue += months[m].revenue;
      totalCost += months[m].cost;
      totalSalary += months[m].salary;
      totalOrders += months[m].orders;
      totalItems += months[m].items;
      totalOpEx += (opexByMonth[m] ? opexByMonth[m].total : 0);
      totalTax += (finalTaxByMonth[m] ? finalTaxByMonth[m].amount : 0);
    });
    var grossProfit = totalRevenue - totalCost;           // Revenue - COGS (incl. piece-rate work)
    var ebit = grossProfit - totalOpEx;                    // Gross - OpEx
    var netProfit = ebit - totalTax;                       // EBIT - taxes
    var grossMargin = totalRevenue > 0 ? (grossProfit/totalRevenue*100) : 0;
    var netMargin = totalRevenue > 0 ? (netProfit/totalRevenue*100) : 0;
    var totalProfit = netProfit; // for chart backwards-compat
  
    // Summary cards (classic P&L)
    document.getElementById('analytics-summary').innerHTML =
      '<div class="card"><div class="card-label">Виручка</div><div class="card-value">'+fmt(totalRevenue)+'</div><div class="card-sub">грн · '+totalOrders+' замовл. · '+totalItems+' шт</div></div>'+
      '<div class="card"><div class="card-label">− Собівартість (COGS)</div><div class="card-value">'+fmt(totalCost)+'</div><div class="card-sub">грн (матеріали + друк + робота)</div></div>'+
      '<div class="card '+(grossProfit>=0?'success':'danger')+'"><div class="card-label">= Валовий прибуток</div><div class="card-value">'+fmt(grossProfit)+'</div><div class="card-sub">грн ('+fmt(grossMargin)+'%)</div></div>'+
      '<div class="card"><div class="card-label">− Операційні витрати</div><div class="card-value">'+fmt(totalOpEx)+'</div><div class="card-sub">грн (оренда, реклама…)</div></div>'+
      '<div class="card"><div class="card-label">− Податки</div><div class="card-value">'+fmt(totalTax)+'</div><div class="card-sub">грн</div></div>'+
      '<div class="card '+(netProfit>=0?'success':'danger')+'" style="border-left:4px solid '+(netProfit>=0?'var(--success)':'var(--danger)')+';"><div class="card-label">💰 = Чистий прибуток</div><div class="card-value">'+fmt(netProfit)+'</div><div class="card-sub">грн ('+fmt(netMargin)+'%)</div></div>';
  
    // ---- P&L Table (full breakdown per month) ----
    var monthNamesShort = ['','Січ','Лют','Бер','Кві','Тра','Чер','Лип','Сер','Вер','Жов','Лис','Гру'];
    // Collect all OpEx categories used in period
    var allOpExCats = {};
    sortedMonths.forEach(function(m) {
      if (opexByMonth[m]) Object.keys(opexByMonth[m].byCat).forEach(function(c){ allOpExCats[c]=true; });
    });
    var opexCatList = Object.keys(allOpExCats).sort();
  
    var pnlHtml = '<thead><tr><th style="min-width:180px;">Показник</th>';
    sortedMonths.forEach(function(m) {
      var mn = parseInt(m.slice(5,7));
      pnlHtml += '<th>'+monthNamesShort[mn]+' '+m.slice(2,4)+'</th>';
    });
    pnlHtml += '<th style="background:#EDE7F6;">Разом</th></tr></thead><tbody>';
  
    function pnlRow(label, values, total, opts) {
      opts = opts || {};
      var style = opts.bold ? 'font-weight:700;' : '';
      if (opts.bg) style += 'background:'+opts.bg+';';
      if (opts.color) style += 'color:'+opts.color+';';
      var row = '<tr style="'+style+'"><td data-label="Показник">'+label+'</td>';
      values.forEach(function(v){ row += '<td>'+(v===0 || v===null ? '—' : fmt(v)+' грн')+'</td>'; });
      row += '<td style="background:#EDE7F6;">'+(total===0? '—' : fmt(total)+' грн')+'</td></tr>';
      return row;
    }
  
    // Revenue
    var rowValsRevenue = sortedMonths.map(function(m){ return months[m].revenue; });
    pnlHtml += pnlRow('Виручка', rowValsRevenue, totalRevenue, {bold:true, color:'var(--success)'});
    // COGS
    var rowValsCogs = sortedMonths.map(function(m){ return -months[m].cost; });
    pnlHtml += pnlRow('− Собівартість (COGS)', rowValsCogs, -totalCost, {color:'var(--danger)'});
    // Gross profit
    var rowValsGp = sortedMonths.map(function(m){ return months[m].revenue - months[m].cost; });
    pnlHtml += pnlRow('= Валовий прибуток', rowValsGp, grossProfit, {bold:true, bg:'#F3E5F5'});
  
    // OpEx section
    if (opexCatList.length > 0) {
      var rowSepHtml = '<tr><td colspan="'+(sortedMonths.length+2)+'" style="padding-top:8px;font-size:11px;color:var(--text-light);text-transform:uppercase;letter-spacing:0.5px;">Операційні витрати (OpEx)</td></tr>';
      pnlHtml += rowSepHtml;
      opexCatList.forEach(function(cat) {
        var vals = sortedMonths.map(function(m){
          return (opexByMonth[m] && opexByMonth[m].byCat[cat]) ? -opexByMonth[m].byCat[cat] : 0;
        });
        var catTotal = vals.reduce(function(s,x){return s+x;},0);
        pnlHtml += pnlRow('&nbsp;&nbsp;&nbsp;&nbsp;'+esc(cat), vals, catTotal, {color:'var(--danger)'});
      });
      var rowOpExTotal = sortedMonths.map(function(m){ return -(opexByMonth[m]?opexByMonth[m].total:0); });
      pnlHtml += pnlRow('− Всього OpEx', rowOpExTotal, -totalOpEx, {bold:true, color:'var(--danger)'});
    }
  
    // EBIT
    var rowValsEbit = sortedMonths.map(function(m){
      return (months[m].revenue - months[m].cost) - (opexByMonth[m]?opexByMonth[m].total:0);
    });
    pnlHtml += pnlRow('= Операційний прибуток (EBIT)', rowValsEbit, ebit, {bold:true, bg:'#E8F5E9'});
  
    // Taxes
    var rowValsTax = sortedMonths.map(function(m){ return -(finalTaxByMonth[m]?finalTaxByMonth[m].amount:0); });
    var taxLabel = '− Податки';
    pnlHtml += pnlRow(taxLabel, rowValsTax, -totalTax, {color:'var(--danger)'});
  
    // Net profit
    var rowValsNet = sortedMonths.map(function(m){
      var gp = months[m].revenue - months[m].cost;
      var ox = (opexByMonth[m]?opexByMonth[m].total:0);
      var tx = (finalTaxByMonth[m]?finalTaxByMonth[m].amount:0);
      return gp - ox - tx;
    });
    pnlHtml += pnlRow('💰 = Чистий прибуток', rowValsNet, netProfit, {bold:true, bg:netProfit>=0?'#C8E6C9':'#FFCDD2', color:netProfit>=0?'#1B5E20':'#B71C1C'});
  
    pnlHtml += '</tbody>';
  
    var pnlTable = document.getElementById('analytics-pnl-table');
    if (pnlTable) {
      if (sortedMonths.length === 0) {
        pnlTable.innerHTML = '<tbody><tr><td class="text-muted" style="text-align:center;padding:40px;">Немає даних за обраний період</td></tr></tbody>';
      } else {
        pnlTable.innerHTML = pnlHtml;
      }
    }
  
    // Bar chart
    var maxRev = 0;
    sortedMonths.forEach(function(m){ if(months[m].revenue>maxRev) maxRev=months[m].revenue; });
    var monthNames = ['','Січ','Лют','Бер','Кві','Тра','Чер','Лип','Сер','Вер','Жов','Лис','Гру'];
    var chartHtml = '<div style="display:flex;align-items:flex-end;gap:6px;height:200px;padding:10px 0;border-bottom:2px solid var(--border);">';
    sortedMonths.forEach(function(m) {
      var d = months[m];
      var profit = d.revenue - d.cost;
      var revH = maxRev > 0 ? Math.max(d.revenue/maxRev*180, 4) : 4;
      var profH = maxRev > 0 ? Math.max(Math.abs(profit)/maxRev*180, 2) : 2;
      var mn = parseInt(m.slice(5,7));
      var label = monthNames[mn] + ' ' + m.slice(2,4);
      chartHtml += '<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:2px;min-width:40px;">'+
        '<span style="font-size:10px;font-weight:600;color:var(--text-light);">'+fmt(d.revenue)+'</span>'+
        '<div style="width:100%;display:flex;gap:2px;align-items:flex-end;justify-content:center;">'+
          '<div style="width:45%;height:'+revH+'px;background:linear-gradient(180deg,var(--primary),var(--primary-light));border-radius:3px 3px 0 0;" title="Виручка: '+fmt(d.revenue)+' грн"></div>'+
          '<div style="width:45%;height:'+profH+'px;background:'+(profit>=0?'var(--success)':'var(--danger)')+';border-radius:3px 3px 0 0;" title="Прибуток: '+fmt(profit)+' грн"></div>'+
        '</div>'+
        '<span style="font-size:10px;color:var(--text-light);margin-top:4px;">'+label+'</span>'+
      '</div>';
    });
    chartHtml += '</div>';
    chartHtml += '<div style="display:flex;gap:16px;margin-top:8px;font-size:12px;color:var(--text-light);">'+
      '<span>🟣 Виручка</span><span>🟢 Прибуток</span></div>';
    document.getElementById('analytics-chart').innerHTML = sortedMonths.length ? chartHtml : '<p class="text-muted" style="text-align:center;padding:40px;">Немає даних за обраний період</p>';
  
    // Monthly table
    document.getElementById('analytics-table').innerHTML = sortedMonths.map(function(m) {
      var d = months[m];
      var profit = d.revenue - d.cost;
      var margin = d.revenue > 0 ? (profit/d.revenue*100) : 0;
      var mn = parseInt(m.slice(5,7));
      return '<tr>'+
        '<td data-label="Місяць"><strong>'+monthNames[mn]+' '+m.slice(0,4)+'</strong></td>'+
        '<td data-label="Замовлень">'+d.orders+'</td>'+
        '<td data-label="Продано шт">'+d.items+'</td>'+
        '<td data-label="Виручка">'+fmt(d.revenue)+' грн</td>'+
        '<td data-label="Собівартість">'+fmt(d.cost - d.salary)+' грн</td>'+
        '<td data-label="Зарплата">'+fmt(d.salary)+' грн</td>'+
        '<td data-label="Прибуток" class="'+(profit>0?'text-success':'text-danger')+'"><strong>'+fmt(profit)+' грн</strong></td>'+
        '<td data-label="Маржа" class="'+(margin>30?'text-success':margin>15?'text-warning':'text-danger')+'">'+fmt(margin)+'%</td>'+
      '</tr>';
    }).join('') || '<tr><td colspan="8" class="text-muted" style="text-align:center;padding:40px;">Немає даних</td></tr>';
  
    // Top products
    var prodStats = {};
    orders.forEach(function(o) {
      (o.items||[]).forEach(function(item) {
        if (!prodStats[item.productId]) prodStats[item.productId] = { name:item.name||'?', sku:item.sku||'', qty:0, revenue:0, cost:0 };
        prodStats[item.productId].qty += item.qty||0;
        prodStats[item.productId].revenue += (item.qty||0)*(item.price||0);
        var p = db.products.find(function(x){return x.id===item.productId});
        if (p) {
          var c = calcCost(p, db.materials, db);
          prodStats[item.productId].cost += c.total*(item.qty||0);
        }
      });
    });
    var topProds = Object.values(prodStats).sort(function(a,b){return b.revenue-a.revenue});
    document.getElementById('analytics-top').innerHTML = topProds.map(function(p) {
      var profit = p.revenue - p.cost;
      var margin = p.revenue > 0 ? (profit/p.revenue*100) : 0;
      return '<tr>'+
        '<td data-label="Гра"><strong>'+(p.sku?'<code>'+esc(p.sku)+'</code> — ':'')+esc(p.name)+'</strong></td>'+
        '<td data-label="Продано">'+p.qty+' шт</td>'+
        '<td data-label="Виручка">'+fmt(p.revenue)+' грн</td>'+
        '<td data-label="Собівартість">'+fmt(p.cost)+' грн</td>'+
        '<td data-label="Прибуток" class="'+(profit>0?'text-success':'text-danger')+'">'+fmt(profit)+' грн</td>'+
        '<td data-label="Маржа" class="'+(margin>30?'text-success':margin>15?'text-warning':'text-danger')+'">'+fmt(margin)+'%</td>'+
      '</tr>';
    }).join('') || '<tr><td colspan="6" class="text-muted" style="text-align:center;padding:40px;">Немає даних</td></tr>';
  
    // Channel stats
    var channelStats = {};
    orders.forEach(function(o) {
      var ch = o.channel || 'Не вказано';
      if (!channelStats[ch]) channelStats[ch] = { orders:0, items:0, revenue:0 };
      channelStats[ch].orders++;
      (o.items||[]).forEach(function(item) {
        channelStats[ch].items += item.qty||0;
        channelStats[ch].revenue += (item.qty||0) * (item.price||0);
      });
    });
    var channelNames = Object.keys(channelStats).sort(function(a,b){ return channelStats[b].revenue - channelStats[a].revenue; });
  
    // Channel cards (visual)
    var chCardsHtml = '';
    channelNames.forEach(function(ch) {
      var s = channelStats[ch];
      var col = getChannelColor(ch === 'Не вказано' ? '' : ch);
      var pct = totalRevenue > 0 ? Math.round(s.revenue / totalRevenue * 100) : 0;
      chCardsHtml += '<div class="card" style="border-left:4px solid '+col.bg+';"><div class="card-label" style="color:'+col.text+';">'+esc(ch)+'</div><div class="card-value">'+fmt(s.revenue)+'</div><div class="card-sub">грн ('+pct+'%) · '+s.orders+' замовл.</div></div>';
    });
    document.getElementById('analytics-channels-cards').innerHTML = chCardsHtml || '<p class="text-muted">Немає даних</p>';
  
    // Channel table
    document.getElementById('analytics-channels').innerHTML = channelNames.map(function(ch) {
      var s = channelStats[ch];
      var col = getChannelColor(ch === 'Не вказано' ? '' : ch);
      var pct = totalRevenue > 0 ? (s.revenue / totalRevenue * 100) : 0;
      return '<tr>'+
        '<td data-label="Канал"><span style="display:inline-block;padding:2px 10px;border-radius:10px;font-size:12px;font-weight:600;background:'+col.bg+';color:'+col.text+';">'+esc(ch)+'</span></td>'+
        '<td data-label="Замовлень">'+s.orders+'</td>'+
        '<td data-label="Продано">'+s.items+' шт</td>'+
        '<td data-label="Виручка">'+fmt(s.revenue)+' грн</td>'+
        '<td data-label="Частка"><div style="display:flex;align-items:center;gap:8px;"><div class="progress-bar" style="flex:1;max-width:100px;"><div class="progress-fill" style="width:'+pct+'%;background:'+col.bg+';"></div></div><strong>'+fmt(pct)+'%</strong></div></td>'+
      '</tr>';
    }).join('') || '<tr><td colspan="5" class="text-muted" style="text-align:center;padding:40px;">Немає даних</td></tr>';
  }
  

  window.setAnalyticsPeriod = setAnalyticsPeriod;
  window.renderAnalytics = renderAnalytics;
})();
