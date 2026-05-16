// ============================================================
// LipoLand — Clients module
// ============================================================
// Клієнт = агрегація з усіх замовлень за phone+email.
// Ключ: нормалізований телефон (приоритет) → email → ім'я fallback.
// Метадані (теги/нотатки) зберігаються в db.clientMeta[clientKey].

(function(){
  'use strict';

  function normPhone(s) {
    return String(s||'').replace(/[^\d+]/g, '').replace(/^\+?38/, '').replace(/^0/, '');
  }
  function normEmail(s) { return String(s||'').toLowerCase().trim(); }

  function clientKeyOf(o) {
    var p = normPhone(o.phone);
    var e = normEmail(o.email);
    if (p) return 'p:'+p;
    if (e) return 'e:'+e;
    var n = (o.client || ((o.firstName||'')+' '+(o.lastName||''))).trim().toLowerCase();
    return n ? 'n:'+n : null;
  }

  function aggregateClients(db) {
    var map = {};
    (db.orders||[]).forEach(function(o){
      var k = clientKeyOf(o);
      if (!k) return;
      if (!map[k]) {
        map[k] = {
          key: k,
          firstName: o.firstName||'', lastName: o.lastName||'',
          client: o.client || ((o.firstName||'')+' '+(o.lastName||'')).trim(),
          phone: o.phone||'', email: o.email||'',
          orders: [], total: 0, count: 0,
          firstDate: o.date||'', lastDate: o.date||'',
          channels: {}, paidCount: 0, paidSum: 0, returnedCount: 0
        };
      }
      var c = map[k];
      c.orders.push(o);
      c.count++;
      var t = Number(o.total)||0;
      c.total += t;
      if (o.paymentStatus === 'paid') { c.paidCount++; c.paidSum += t; }
      if (o.returnedToStock) c.returnedCount++;
      if (o.channel) c.channels[o.channel] = (c.channels[o.channel]||0) + 1;
      var d = o.date || '';
      if (d) {
        if (!c.firstDate || d < c.firstDate) c.firstDate = d;
        if (!c.lastDate || d > c.lastDate) c.lastDate = d;
      }
      if (!c.phone && o.phone) c.phone = o.phone;
      if (!c.email && o.email) c.email = o.email;
      if ((!c.firstName || !c.lastName) && (o.firstName || o.lastName)) {
        if (!c.firstName) c.firstName = o.firstName || '';
        if (!c.lastName) c.lastName = o.lastName || '';
        c.client = (c.firstName + ' ' + c.lastName).trim() || c.client;
      }
    });
    var meta = db.clientMeta || {};
    Object.keys(map).forEach(function(k){
      var m = meta[k] || {};
      map[k].tags = m.tags || [];
      map[k].note = m.note || '';
      map[k].avg = map[k].count ? Math.round(map[k].total / map[k].count) : 0;
    });
    return map;
  }

  function daysSince(dateStr) {
    if (!dateStr) return null;
    var d = new Date(dateStr);
    if (isNaN(d.getTime())) return null;
    return Math.floor((Date.now() - d.getTime()) / (1000*60*60*24));
  }

  function renderClients() {
    var db = getDB();
    var clientsMap = aggregateClients(db);
    var clients = Object.keys(clientsMap).map(function(k){ return clientsMap[k]; });

    var segment = document.getElementById('cli-segment').value;
    var search = (document.getElementById('cli-search').value||'').toLowerCase().trim();
    var tagFilterEl = document.getElementById('cli-tag-filter');
    var tagFilter = tagFilterEl ? tagFilterEl.value : '';

    var allTags = {};
    clients.forEach(function(c){ (c.tags||[]).forEach(function(t){ allTags[t]=true; }); });
    var tagKeys = Object.keys(allTags).sort();
    tagFilterEl.innerHTML = '<option value="">Усі теги</option>' + tagKeys.map(function(t){return '<option value="'+esc(t)+'" '+(t===tagFilter?'selected':'')+'>'+esc(t)+'</option>';}).join('');
    tagFilterEl.style.display = (segment === 'tagged' || tagKeys.length > 0) ? '' : 'none';

    var filtered = clients.filter(function(c){
      if (segment === 'repeat' && c.count < 2) return false;
      if (segment === 'vip' && c.count < 5) return false;
      if (segment === 'new' && c.count !== 1) return false;
      if (segment === 'silent') {
        var d = daysSince(c.lastDate);
        if (d === null || d < 90) return false;
      }
      if (segment === 'tagged' && (!c.tags || !c.tags.length)) return false;
      if (tagFilter && (!c.tags || c.tags.indexOf(tagFilter) === -1)) return false;
      if (search) {
        var hay = ((c.client||'')+' '+(c.phone||'')+' '+(c.email||'')+' '+(c.tags||[]).join(' ')).toLowerCase();
        if (hay.indexOf(search) === -1) return false;
      }
      return true;
    });
    filtered.sort(function(a,b){ return (b.lastDate||'').localeCompare(a.lastDate||''); });

    var total = clients.length;
    var repeat = clients.filter(function(c){return c.count>=2;}).length;
    var vip = clients.filter(function(c){return c.count>=5;}).length;
    var silent = clients.filter(function(c){var d=daysSince(c.lastDate); return d!==null && d>=90;}).length;
    var totalRevenue = clients.reduce(function(s,c){return s+c.total;}, 0);
    var avgLTV = total ? Math.round(totalRevenue/total) : 0;
    document.getElementById('cli-cards').innerHTML =
      '<div class="card"><div class="card-label">Всього клієнтів</div><div class="card-value">'+total+'</div></div>'+
      '<div class="card '+(repeat>0?'success':'')+'"><div class="card-label">🔁 Повторні</div><div class="card-value">'+repeat+'</div><div class="card-sub">'+(total?Math.round(repeat/total*100):0)+'% від усіх</div></div>'+
      '<div class="card"><div class="card-label">⭐ VIP (5+)</div><div class="card-value">'+vip+'</div></div>'+
      '<div class="card '+(silent>0?'warning':'')+'"><div class="card-label">😴 Тихі (90+ днів)</div><div class="card-value">'+silent+'</div><div class="card-sub">кандидати на ремаркетинг</div></div>'+
      '<div class="card"><div class="card-label">Середній LTV</div><div class="card-value">'+fmt(avgLTV)+' <span style="font-size:14px;">грн</span></div><div class="card-sub">всього: '+fmt(totalRevenue)+' грн</div></div>';

    document.getElementById('cli-table').innerHTML = filtered.map(function(c){
      var d = daysSince(c.lastDate);
      var freshness = d === null ? '—' : (d === 0 ? 'сьогодні' : d===1 ? 'вчора' : d+' дн.');
      var freshnessColor = d === null ? 'var(--text-light)' : d < 30 ? 'var(--success)' : d < 90 ? 'var(--warning)' : 'var(--danger)';
      var tagsHtml = (c.tags||[]).map(function(t){return '<span class="badge" style="background:#E1BEE7;color:#4A148C;font-size:10px;margin-right:3px;">'+esc(t)+'</span>';}).join('') || '<span class="text-muted" style="font-size:11px;">—</span>';
      var contacts = '';
      if (c.phone) contacts += '<div style="font-size:12px;">📞 '+esc(c.phone)+'</div>';
      if (c.email) contacts += '<div style="font-size:12px;color:var(--text-light);">✉ '+esc(c.email)+'</div>';
      if (!contacts) contacts = '<span class="text-muted" style="font-size:11px;">—</span>';
      var chCount = Object.keys(c.channels||{}).length;
      var channelsHtml = chCount ? Object.keys(c.channels).sort().map(function(ch){return '<span style="font-size:10px;color:var(--text-light);">'+esc(ch)+(c.channels[ch]>1?' ×'+c.channels[ch]:'')+'</span>';}).join('<br>') : '—';
      var vipBadge = c.count >= 5 ? ' <span class="badge" style="background:#FFC107;color:#5d4400;font-size:10px;">⭐ VIP</span>' : (c.count >= 2 ? ' <span class="badge" style="background:#E8F5E9;color:#2E7D32;font-size:10px;">🔁</span>' : '');
      var returnedBadge = c.returnedCount > 0 ? ' <span class="badge" style="background:#FFEBEE;color:#B71C1C;font-size:10px;" title="'+c.returnedCount+' повернень/відмов">↩ '+c.returnedCount+'</span>' : '';
      var noteTrim = c.note ? (c.note.length > 50 ? c.note.slice(0,50)+'…' : c.note) : '';
      return '<tr>'+
        '<td data-label="Клієнт"><strong>'+esc(c.client||'?')+'</strong>'+vipBadge+returnedBadge+'</td>'+
        '<td data-label="Контакти">'+contacts+'</td>'+
        '<td data-label="Теги">'+tagsHtml+'</td>'+
        '<td data-label="Замовлень" style="text-align:center;"><strong>'+c.count+'</strong></td>'+
        '<td data-label="Сума"><strong>'+fmt(c.total)+' грн</strong>'+(c.paidSum<c.total?'<div style="font-size:11px;color:var(--text-light);">оплачено: '+fmt(c.paidSum)+'</div>':'')+'</td>'+
        '<td data-label="Сер. чек">'+fmt(c.avg)+' грн</td>'+
        '<td data-label="Остання" style="color:'+freshnessColor+';font-size:12px;">'+esc(c.lastDate||'—')+'<div style="font-size:10px;">'+freshness+'</div></td>'+
        '<td data-label="Канали" style="font-size:11px;">'+channelsHtml+'</td>'+
        '<td data-label="Нотатка" style="font-size:12px;color:var(--text-light);max-width:160px;" title="'+esc(c.note||'')+'">'+esc(noteTrim||'—')+'</td>'+
        '<td data-label="Дії" style="white-space:nowrap;">'+
          '<button class="btn btn-outline btn-sm" onclick="openClientDetail(\''+c.key+'\')" title="Картка з історією">📋</button>'+
        '</td>'+
      '</tr>';
    }).join('') || '<tr><td colspan="10" class="text-muted" style="text-align:center;padding:40px;">'+(clients.length?'Немає клієнтів за поточним фільтром':'Клієнтів ще немає — створи перше замовлення')+'</td></tr>';
  }

  var _currentClientKey = null;
  function openClientDetail(key) {
    var db = getDB();
    var clients = aggregateClients(db);
    var c = clients[key];
    if (!c) return;
    _currentClientKey = key;
    window._currentClientKey = key;
    document.getElementById('cli-detail-title').textContent = '👤 ' + (c.client || 'Клієнт');

    var ordersSorted = c.orders.slice().sort(function(a,b){ return (b.date||'').localeCompare(a.date||''); });
    var statusMap = {};
    (db.orderStatuses || getOrderStatuses()).forEach(function(s){ statusMap[s.id] = s.label; });

    var ordersHtml = ordersSorted.map(function(o){
      var statusLbl = statusMap[o.status] || o.status || '—';
      var itemsLine = (o.items||[]).map(function(i){return esc(i.name)+' ×'+i.qty;}).join(', ');
      var returnTag = o.returnedToStock ? (o.returnAsDefect ? ' <span style="color:#B71C1C;font-size:11px;">🚫 БРАК</span>' : ' <span style="color:#E65100;font-size:11px;">↩ повернено</span>') : '';
      var payTag = o.paymentStatus === 'paid' ? ' ✓' : (o.paymentStatus === 'partial' ? ' ◐' : ' ✗');
      return '<tr style="border-bottom:1px solid #f0f0f0;">'+
        '<td style="padding:6px 8px;font-size:12px;">#'+o.num+'</td>'+
        '<td style="padding:6px 8px;font-size:12px;">'+esc(o.date||'')+'</td>'+
        '<td style="padding:6px 8px;font-size:12px;">'+esc(statusLbl)+returnTag+'</td>'+
        '<td style="padding:6px 8px;font-size:12px;">'+esc(itemsLine||'—')+'</td>'+
        '<td style="padding:6px 8px;font-size:12px;text-align:right;font-weight:600;">'+fmt(o.total||0)+' грн'+payTag+'</td>'+
        '<td style="padding:6px 8px;text-align:center;"><button class="btn btn-outline btn-sm" onclick="closeModal(\'client-detail\');openEditOrder(\''+o.id+'\')" title="Відкрити замовлення" style="font-size:11px;padding:2px 8px;">✏️</button></td>'+
      '</tr>';
    }).join('');

    var tagsStr = (c.tags||[]).join(', ');
    var d = daysSince(c.lastDate);
    var freshness = d === null ? '—' : d===0?'сьогодні':d===1?'вчора':d+' днів тому';

    document.getElementById('cli-detail-body').innerHTML =
      '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:10px;margin-bottom:16px;">'+
        '<div class="card" style="margin:0;"><div class="card-label">Замовлень</div><div class="card-value">'+c.count+'</div></div>'+
        '<div class="card" style="margin:0;"><div class="card-label">Сума всього</div><div class="card-value" style="font-size:20px;">'+fmt(c.total)+' грн</div></div>'+
        '<div class="card" style="margin:0;"><div class="card-label">Середній чек</div><div class="card-value" style="font-size:20px;">'+fmt(c.avg)+' грн</div></div>'+
        '<div class="card" style="margin:0;"><div class="card-label">Остання покупка</div><div class="card-value" style="font-size:14px;">'+esc(c.lastDate||'—')+'</div><div class="card-sub">'+freshness+'</div></div>'+
      '</div>'+
      '<div style="background:#FAFAFE;border:1px solid var(--border);border-radius:8px;padding:12px;margin-bottom:16px;">'+
        '<div style="display:flex;gap:12px;flex-wrap:wrap;font-size:13px;">'+
          (c.phone?'<div>📞 <a href="tel:'+esc(c.phone)+'">'+esc(c.phone)+'</a></div>':'')+
          (c.email?'<div>✉ <a href="mailto:'+esc(c.email)+'">'+esc(c.email)+'</a></div>':'')+
        '</div>'+
      '</div>'+
      '<div class="form-group mb-16"><label>🏷 Теги (через кому)</label>'+
        '<input type="text" id="cli-meta-tags" value="'+esc(tagsStr)+'" placeholder="напр.: логопед, школа, опт, VIP">'+
        '<span class="text-muted" style="font-size:11px;margin-top:4px;display:block;">Допомагає сегментувати клієнтів. Один тег = одна спільна риса.</span>'+
      '</div>'+
      '<div class="form-group mb-16"><label>📝 Нотатка</label>'+
        '<textarea id="cli-meta-note" rows="3" placeholder="Спецшкола №...; платить наперед; любить дякувати в Direct...">'+esc(c.note||'')+'</textarea>'+
      '</div>'+
      '<div class="section-title" style="margin-top:8px;">Історія замовлень ('+c.count+')</div>'+
      '<div class="table-wrap" style="max-height:340px;overflow-y:auto;">'+
        '<table style="width:100%;font-size:12px;">'+
          '<thead><tr style="background:#F3E5F5;color:#4A148C;position:sticky;top:0;"><th style="padding:6px 8px;text-align:left;">№</th><th style="padding:6px 8px;text-align:left;">Дата</th><th style="padding:6px 8px;text-align:left;">Статус</th><th style="padding:6px 8px;text-align:left;">Товари</th><th style="padding:6px 8px;text-align:right;">Сума</th><th style="padding:6px 8px;"></th></tr></thead>'+
          '<tbody>'+ordersHtml+'</tbody>'+
        '</table>'+
      '</div>';

    openModal('client-detail');
  }

  function saveClientMeta() {
    if (!_currentClientKey) return;
    var db = getDB();
    if (!db.clientMeta) db.clientMeta = {};
    var tagsStr = (document.getElementById('cli-meta-tags').value || '').trim();
    var tags = tagsStr ? tagsStr.split(',').map(function(t){return t.trim();}).filter(Boolean) : [];
    var note = (document.getElementById('cli-meta-note').value || '').trim();
    db.clientMeta[_currentClientKey] = { tags: tags, note: note };
    if (typeof logAudit === 'function') logAudit(db, 'client', _currentClientKey, 'edit', { tags: tags.join(', '), noteLen: note.length });
    saveDB(db);
    closeModal('client-detail');
    renderClients();
  }

  // Експортуємо для inline-обробників
  window.renderClients = renderClients;
  window.openClientDetail = openClientDetail;
  window.saveClientMeta = saveClientMeta;
  window.aggregateClients = aggregateClients; // на випадок майбутніх інтеграцій
})();
