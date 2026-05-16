// ============================================================
// LipoLand — Dashboard module
// ============================================================
// Головна сторінка з картками: revenue, profit, low-stock alerts,
// пульс місяця. renderDashboardPulse — секція з активністю по дням.

(function(){
  'use strict';

  // ==================== DASHBOARD ====================
  function renderDashboard() {
    var db = getDB();
    var isW = _currentUser && _currentUser.isWorker;
    var wp = isW ? (_currentUser.workerPermissions || {}) : {};
  
    // --- Alerts (only for owner) ---
    if (!isW) {
      var alerts = [];
      var dismissed = JSON.parse(localStorage.getItem('lipo_dismissed_alerts') || '{}');
      var today = new Date().toISOString().slice(0,10);
      Object.keys(dismissed).forEach(function(k){ if(dismissed[k] !== today) delete dismissed[k]; });
      localStorage.setItem('lipo_dismissed_alerts', JSON.stringify(dismissed));
      db.materials.forEach(function(m) {
        var key = 'mat_'+m.id;
        if (dismissed[key]) return;
        var atW = matAtWorkers(db, m.id);
        var total = (m.qty||0) + atW;
        var atWNote = atW>0 ? ' (у майстрів: '+fmt(atW)+')' : '';
        if(total<=0) alerts.push({type:'danger', key:key, text:'<strong>'+esc(m.name)+'</strong> — закінчився! '+(m.supplier?'Постачальник: '+esc(m.supplier):'')});
        else if(total <= m.min) alerts.push({type:'warning', key:key, text:'<strong>'+esc(m.name)+'</strong> — залишок '+fmt(total)+' '+esc(m.unit)+atWNote+' (мін: '+m.min+'). Пора замовити!'});
      });
      document.getElementById('dash-alerts').innerHTML = alerts.map(function(a){
        return '<div class="alert alert-'+a.type+'" id="alert-'+a.key+'">'+a.text+'<button class="alert-close" onclick="dismissAlert(\''+a.key+'\')" title="Приховати на сьогодні">&times;</button></div>';
      }).join('');
    } else {
      document.getElementById('dash-alerts').innerHTML = '';
    }
  
    // --- Cards ---
    var totalStock = db.products.reduce(function(s,p){return s+(p.stock||0)},0);
    var totalInProgress = db.products.reduce(function(s,p){return s+(p.inProgress||0)},0);
    var thisMonth = new Date().toISOString().slice(0,7);
    var wName = isW ? (_currentUser.linkedWorkerName || '') : '';
    var monthOrders = db.orders.filter(function(o){
      if (o.date.indexOf(thisMonth)!==0) return false;
      if (isW && wName && (o.worker||'') !== wName) return false;
      return true;
    });
  
    if (isW) {
      // Worker dashboard — only relevant cards
      var cardsHtml = '';
      if (wp.production) cardsHtml += '<div class="card"><div class="card-label">В виробництві</div><div class="card-value">'+totalInProgress+' шт</div></div>';
      if (wp.workerStock) {
        var wsTotal = (db.workerStock||[]).reduce(function(s,ws){return s+(ws.qty||0)},0);
        cardsHtml += '<div class="card success"><div class="card-label">У мене на складі</div><div class="card-value">'+wsTotal+' шт</div></div>';
      }
      if (wp.orders) cardsHtml += '<div class="card"><div class="card-label">Замовлення ('+thisMonth+')</div><div class="card-value">'+monthOrders.length+'</div></div>';
      cardsHtml += '<div class="card"><div class="card-label">Товарів у каталозі</div><div class="card-value">'+db.products.length+'</div></div>';
      document.getElementById('dash-cards').innerHTML = cardsHtml;
      var pulseWrap = document.getElementById('dash-pulse-wrap');
      if (pulseWrap) pulseWrap.style.display = 'none';
    } else {
      // Owner dashboard — full cards
      var lowMats = db.materials.filter(function(m){return matTotalQty(db,m)<=m.min}).length;
      var totalStockValue = db.products.reduce(function(s,p){return s+(p.stock||0)*p.sellPrice},0);
      var monthRevenue = monthOrders.reduce(function(s,o){return s+o.total},0);
      document.getElementById('dash-cards').innerHTML =
        '<div class="card success"><div class="card-label">На складі готового</div><div class="card-value">'+totalStock+' шт</div><div class="card-sub">'+fmt(totalStockValue)+' грн</div></div>'+
        '<div class="card"><div class="card-label">В виробництві</div><div class="card-value">'+totalInProgress+' шт</div></div>'+
        '<div class="card '+(lowMats>0?'danger':'success')+'"><div class="card-label">Матеріали</div><div class="card-value">'+lowMats+'</div><div class="card-sub">'+(lowMats>0?'потребують замовлення':'все в нормі')+'</div></div>'+
        '<div class="card"><div class="card-label">Замовлення ('+thisMonth+')</div><div class="card-value">'+monthOrders.length+'</div><div class="card-sub">'+fmt(monthRevenue)+' грн</div></div>'+
        '<div class="card"><div class="card-label">Товарів у каталозі</div><div class="card-value">'+db.products.length+'</div></div>';
  
      // --- Фінансовий пульс (owner-only quick stats) ---
      renderDashboardPulse(db, thisMonth);
    }
  
    // --- Materials table (only for owner or if worker has materials permission) ---
    if (!isW || wp.materials) {
      var critMats = db.materials.filter(function(m){return matTotalQty(db,m)<=m.min*1.5}).sort(function(a,b){return matTotalQty(db,a)/Math.max(a.min,0.01) - matTotalQty(db,b)/Math.max(b.min,0.01)});
      document.getElementById('dash-materials').innerHTML = critMats.map(function(m) {
        var total = matTotalQty(db, m);
        var status = total<=0 ? '<span class="badge badge-danger">Немає!</span>' : total<=m.min ? '<span class="badge badge-warning">Замовити!</span>' : '<span class="badge badge-ok">Мало</span>';
        var usedIn = db.products.filter(function(p){return (p.recipe||[]).some(function(r){return r.materialId===m.id})});
        var enough = usedIn.map(function(p){
          var r = p.recipe.find(function(r){return r.materialId===m.id});
          return r ? esc(p.name)+': '+Math.floor(total/r.qty)+' шт' : '';
        }).filter(Boolean).join(', ');
        var atW = matAtWorkers(db, m.id);
        var qtyCell = atW>0 ? fmt(total)+' '+esc(m.unit)+' <small style="color:var(--text-light);">('+fmt(m.qty)+' тут + '+fmt(atW)+' у майстрів)</small>' : fmt(m.qty)+' '+esc(m.unit);
        return '<tr><td data-label="Матеріал">'+esc(m.name)+'</td><td data-label="Залишок">'+qtyCell+'</td><td data-label="Мінімум">'+fmt(m.min)+' '+esc(m.unit)+'</td><td data-label="Статус">'+status+'</td><td data-label="Вистачить на" class="text-muted" style="font-size:12px;">'+(enough||'—')+'</td></tr>';
      }).join('') || '<tr><td colspan="5" class="text-muted" style="text-align:center;padding:20px;">Все в нормі</td></tr>';
      document.getElementById('dash-materials').closest('.card-section') && (document.getElementById('dash-materials').parentNode.parentNode.style.display = '');
    } else {
      // Hide materials section for worker
      var matTable = document.getElementById('dash-materials');
      if (matTable) {
        matTable.innerHTML = '';
        var matSection = matTable.parentNode.parentNode;
        if (matSection) matSection.style.display = 'none';
      }
    }
  
    // --- Products table ---
    var dashProds = db.products.filter(function(p){return (p.stock||0)>0 || (p.inProgress||0)>0});
    document.getElementById('dash-products').innerHTML = dashProds.map(function(p) {
      if (isW) {
        // Worker sees no cost info
        return '<tr><td data-label="Артикул"><code>'+esc(p.sku||'—')+'</code></td><td data-label="Гра"><strong>'+esc(p.name)+'</strong></td><td data-label="Категорія">'+esc(p.category||'—')+'</td><td data-label="На складі">'+(p.stock||0)+'</td><td data-label="В роботі">'+(p.inProgress||0)+'</td></tr>';
      }
      var can = calcCanProduce(p, db.materials);
      return '<tr><td data-label="Артикул"><code>'+esc(p.sku||'—')+'</code></td><td data-label="Гра"><strong>'+esc(p.name)+'</strong></td><td data-label="Категорія">'+esc(p.category||'—')+'</td><td data-label="На складі">'+(p.stock||0)+'</td><td data-label="В роботі">'+(p.inProgress||0)+'</td><td data-label="Можна зібрати">'+can+' шт</td></tr>';
    }).join('') || '<tr><td colspan="6" class="text-muted" style="text-align:center;padding:20px;">Склад порожній</td></tr>';
  }
  
  function renderDashboardPulse(db, thisMonth) {
    var wrap = document.getElementById('dash-pulse-wrap');
    var pulse = document.getElementById('dash-pulse');
    var topEl = document.getElementById('dash-top-products');
    if (!wrap || !pulse) return;
    wrap.style.display = '';
  
    // Previous month key (YYYY-MM)
    var y = parseInt(thisMonth.slice(0,4));
    var m = parseInt(thisMonth.slice(5,7));
    var pm = m - 1, py = y;
    if (pm === 0) { pm = 12; py = y - 1; }
    var prevMonth = py + '-' + (pm < 10 ? '0'+pm : ''+pm);
  
    // Aggregate current & previous month
    function aggregate(monthKey) {
      var agg = { revenue:0, cost:0, salary:0, orders:0, items:0, byProduct:{} };
      (db.orders||[]).forEach(function(o){
        if ((o.date||'').slice(0,7) !== monthKey) return;
        agg.orders++;
        (o.items||[]).forEach(function(it){
          var q = it.qty||0;
          agg.items += q;
          agg.revenue += q * (it.price||0);
          var p = db.products.find(function(x){return x.id===it.productId});
          if (p) {
            var c = calcCost(p, db.materials, db);
            agg.cost += c.total * q;
            agg.salary += c.work * q;
          }
          var pname = p ? p.name : (it.name || '—');
          if (!agg.byProduct[pname]) agg.byProduct[pname] = { qty:0, revenue:0 };
          agg.byProduct[pname].qty += q;
          agg.byProduct[pname].revenue += q * (it.price||0);
        });
      });
      agg.profit = agg.revenue - agg.cost;
      return agg;
    }
  
    var cur = aggregate(thisMonth);
    var prev = aggregate(prevMonth);
  
    // Add OpEx + taxes for true Net Profit (both months)
    function opExFor(monthKey) {
      var total = 0, manualTax = 0;
      (db.expenses||[]).forEach(function(e) {
        if ((e.date||'').slice(0,7) !== monthKey) return;
        total += (e.amount||0);
        if (e.category === '🧾 Податки') manualTax += (e.amount||0);
      });
      return { total:total, manualTax:manualTax };
    }
    function taxFor(monthKey, revenue, manualTax) {
      if (manualTax > 0) return manualTax;
      var t = computeTaxForMonth(db, monthKey, revenue);
      return t.amount || 0;
    }
    var curOp = opExFor(thisMonth);
    var prevOp = opExFor(prevMonth);
    var curTax = taxFor(thisMonth, cur.revenue, curOp.manualTax);
    var prevTax = taxFor(prevMonth, prev.revenue, prevOp.manualTax);
    // Net = GP - (OpEx incl. manual tax, minus manual-tax-double) - auto tax
    // OpEx total already contains manualTax; to avoid double count we subtract manualTax once then add "final tax"
    cur.opexNet = curOp.total - curOp.manualTax;
    prev.opexNet = prevOp.total - prevOp.manualTax;
    cur.netProfit = cur.profit - cur.opexNet - curTax;
    prev.netProfit = prev.profit - prev.opexNet - prevTax;
  
    function diffBadge(curV, prevV) {
      if (prevV === 0 && curV === 0) return '<span style="color:var(--text-light);font-size:12px;">—</span>';
      if (prevV === 0) return '<span style="color:var(--success);font-size:12px;font-weight:600;">↑ новий</span>';
      var delta = ((curV - prevV) / prevV) * 100;
      var sign = delta >= 0 ? '↑' : '↓';
      var color = delta >= 0 ? 'var(--success)' : 'var(--danger)';
      return '<span style="color:'+color+';font-size:12px;font-weight:600;">'+sign+' '+fmt(Math.abs(delta))+'% vs '+prevMonth+'</span>';
    }
  
    // Forecast: extrapolate current pace to month end
    var nowDate = new Date();
    var isCurrentRealMonth = thisMonth === nowDate.toISOString().slice(0,7);
    var dayOfMonth = nowDate.getDate();
    var daysInMonth = new Date(y, m, 0).getDate();
    var pace = (isCurrentRealMonth && dayOfMonth > 0) ? (daysInMonth / dayOfMonth) : 1;
    var fRevenue = cur.revenue * pace;
    var fNet = cur.netProfit * pace;
    var fItems = Math.round(cur.items * pace);
    // Forecast badge — vs previous month actual
    function forecastDiffBadge(forecast, prevV) {
      if (!isCurrentRealMonth) return '<span style="color:var(--text-light);font-size:12px;">місяць закритий</span>';
      if (prevV === 0 && forecast === 0) return '<span style="color:var(--text-light);font-size:12px;">—</span>';
      if (prevV === 0) return '<span style="color:var(--success);font-size:12px;font-weight:600;">↑ новий тренд</span>';
      var delta = ((forecast - prevV) / Math.abs(prevV)) * 100;
      var sign = delta >= 0 ? '↑' : '↓';
      var color = delta >= 0 ? 'var(--success)' : 'var(--danger)';
      var verdict = delta >= 0 ? 'краще' : 'гірше';
      return '<span style="color:'+color+';font-size:12px;font-weight:600;">'+sign+' '+fmt(Math.abs(delta))+'% '+verdict+' за '+prevMonth+'</span>';
    }
    var paceNote = isCurrentRealMonth
      ? '<span style="color:var(--text-light);font-size:11px;">день '+dayOfMonth+'/'+daysInMonth+' • темп збережено</span>'
      : '<span style="color:var(--text-light);font-size:11px;">не поточний місяць</span>';
  
    pulse.innerHTML =
      '<div class="card"><div class="card-label">Виручка цього місяця</div><div class="card-value">'+fmt(cur.revenue)+' грн</div><div class="card-sub">'+diffBadge(cur.revenue, prev.revenue)+'</div></div>'+
      '<div class="card '+(cur.profit>=0?'success':'danger')+'"><div class="card-label">Валовий прибуток</div><div class="card-value">'+fmt(cur.profit)+' грн</div><div class="card-sub">'+diffBadge(cur.profit, prev.profit)+'</div></div>'+
      '<div class="card '+(cur.netProfit>=0?'success':'danger')+'" style="border-left:4px solid '+(cur.netProfit>=0?'var(--success)':'var(--danger)')+';"><div class="card-label">💰 Чистий прибуток</div><div class="card-value">'+fmt(cur.netProfit)+' грн</div><div class="card-sub">після OpEx '+fmt(cur.opexNet)+' + податків '+fmt(curTax)+'</div></div>'+
      '<div class="card '+(isCurrentRealMonth ? (fNet>=prev.netProfit?'success':'danger') : '')+'" style="border-left:4px dashed '+(isCurrentRealMonth ? (fNet>=prev.netProfit?'var(--success)':'var(--danger)') : 'var(--border)')+';"><div class="card-label">🔮 Прогноз на кінець місяця</div><div class="card-value">'+(isCurrentRealMonth?fmt(fNet):'—')+(isCurrentRealMonth?' грн':'')+'</div><div class="card-sub">'+(isCurrentRealMonth?'<div>Виручка ~ '+fmt(fRevenue)+' грн</div><div>'+forecastDiffBadge(fNet, prev.netProfit)+'</div><div>'+paceNote+'</div>':paceNote)+'</div></div>'+
      '<div class="card"><div class="card-label">Продано штук</div><div class="card-value">'+cur.items+'</div><div class="card-sub">'+diffBadge(cur.items, prev.items)+'</div></div>';
  
    // Top-3 products this month
    var tops = Object.keys(cur.byProduct).map(function(n){
      return { name:n, qty:cur.byProduct[n].qty, revenue:cur.byProduct[n].revenue };
    }).sort(function(a,b){ return b.revenue - a.revenue; }).slice(0,3);
  
    if (tops.length === 0) {
      topEl.innerHTML = '<p class="text-muted" style="margin:8px 0 0;font-size:13px;">Ще немає продажів у цьому місяці.</p>';
    } else {
      var medals = ['🥇','🥈','🥉'];
      topEl.innerHTML = '<div style="font-weight:600;font-size:13px;color:var(--text-light);margin-bottom:8px;">🏆 Топ-3 товари цього місяця</div>'+
        '<div style="display:flex;gap:8px;flex-wrap:wrap;">'+
        tops.map(function(t,i){
          return '<div style="flex:1;min-width:180px;padding:10px 12px;background:var(--bg);border:1px solid var(--border);border-radius:8px;">'+
            '<div style="font-size:13px;"><span style="font-size:16px;">'+medals[i]+'</span> <strong>'+esc(t.name)+'</strong></div>'+
            '<div style="font-size:12px;color:var(--text-light);margin-top:2px;">'+t.qty+' шт · '+fmt(t.revenue)+' грн</div>'+
          '</div>';
        }).join('')+
        '</div>';
    }
  }

  window.renderDashboard = renderDashboard;
  window.renderDashboardPulse = renderDashboardPulse;
})();
