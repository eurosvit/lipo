// ============================================================
// LipoLand — Order Channels module
// ============================================================
// Канали продажу (Instagram, Etsy, Сайт тощо) — менеджер CRUD,
// палітра кольорів, селекти, інлайн зміна каналу замовлення.

(function(){
  'use strict';

  var _channelColors = [
    { bg:'#E1BEE7', text:'#6A1B9A' },  // purple
    { bg:'#BBDEFB', text:'#1565C0' },  // blue
    { bg:'#C8E6C9', text:'#2E7D32' },  // green
    { bg:'#FFE0B2', text:'#E65100' },  // orange
    { bg:'#F8BBD0', text:'#AD1457' },  // pink
    { bg:'#B2DFDB', text:'#00695C' },  // teal
    { bg:'#FFF9C4', text:'#F57F17' },  // yellow
    { bg:'#D1C4E9', text:'#4527A0' },  // deep purple
    { bg:'#FFCCBC', text:'#BF360C' },  // deep orange
    { bg:'#B3E5FC', text:'#01579B' },  // light blue
  ];

  function getChannelColor(channel) {
    if (!channel) return { bg:'#f0f0f0', text:'#999' };
    var db = getDB();
    var channels = db.orderChannels || [];
    var idx = channels.indexOf(channel);
    if (idx === -1) idx = 0;
    return _channelColors[idx % _channelColors.length];
  }

  function setOrderChannel(id, channel) {
    var db = getDB();
    var ord = db.orders.find(function(x){return x.id===id});
    if(ord) { ord.channel=channel; saveDB(db); renderPage('orders'); }
  }

  function renderChannelManager() {
    var db = getDB();
    var channels = db.orderChannels || [];
    var list = document.getElementById('channel-list');
    if (!list) return;
    list.innerHTML = channels.map(function(ch, i) {
      var col = _channelColors[i % _channelColors.length];
      return '<span style="display:inline-flex;align-items:center;gap:4px;padding:4px 10px;background:'+col.bg+';color:'+col.text+';border-radius:16px;font-size:13px;font-weight:600;">' +
        esc(ch) +
        '<button onclick="renameChannel(\''+esc(ch.replace(/'/g,"\\'"))+'\')" style="background:none;border:none;cursor:pointer;font-size:11px;padding:0 2px;color:'+col.text+';" title="Перейменувати">✏️</button>' +
        '<button onclick="deleteChannel(\''+esc(ch.replace(/'/g,"\\'"))+'\')" style="background:none;border:none;cursor:pointer;font-size:11px;padding:0 2px;color:'+col.text+';" title="Видалити">✕</button>' +
      '</span>';
    }).join('') || '<span class="text-muted" style="font-size:13px;">Додайте перший канал</span>';
  }

  function addChannel() {
    var name = document.getElementById('new-channel-name').value.trim();
    if (!name) return;
    var db = getDB();
    if (!db.orderChannels) db.orderChannels = [];
    if (db.orderChannels.indexOf(name) !== -1) return alert('Такий канал вже є');
    db.orderChannels.push(name);
    saveDB(db);
    document.getElementById('new-channel-name').value = '';
    renderPage('orders');
  }

  function renameChannel(oldName) {
    var newName = prompt('Нова назва каналу:', oldName);
    if (!newName || newName.trim() === '' || newName === oldName) return;
    newName = newName.trim();
    var db = getDB();
    var idx = (db.orderChannels || []).indexOf(oldName);
    if (idx === -1) return;
    db.orderChannels[idx] = newName;
    db.orders.forEach(function(o) { if (o.channel === oldName) o.channel = newName; });
    saveDB(db);
    renderPage('orders');
  }

  function deleteChannel(name) {
    if (!confirm('Видалити канал "'+name+'"?')) return;
    var db = getDB();
    db.orderChannels = (db.orderChannels || []).filter(function(c) { return c !== name; });
    db.orders.forEach(function(o) { if (o.channel === name) o.channel = ''; });
    saveDB(db);
    renderPage('orders');
  }

  function populateOrderChannels() {
    populateOrderChannelSelect('ord-channel');
  }

  function populateOrderChannelSelect(elId) {
    var db = getDB();
    var channels = db.orderChannels || [];
    var el = document.getElementById(elId);
    if (!el) return;
    var currentVal = el.value;
    el.innerHTML = '<option value="">— не вказано —</option>' + channels.map(function(ch) {
      return '<option value="'+esc(ch)+'">'+esc(ch)+'</option>';
    }).join('');
    if (currentVal) el.value = currentVal;
  }

  window.getChannelColor = getChannelColor;
  window.setOrderChannel = setOrderChannel;
  window.renderChannelManager = renderChannelManager;
  window.addChannel = addChannel;
  window.renameChannel = renameChannel;
  window.deleteChannel = deleteChannel;
  window.populateOrderChannels = populateOrderChannels;
  window.populateOrderChannelSelect = populateOrderChannelSelect;
})();
