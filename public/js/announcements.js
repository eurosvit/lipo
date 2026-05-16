// ============================================================
// LipoLand — Announcements module
// ============================================================
// Адмін-функції для оголошень (CRUD) + popup для користувачів,
// dismiss-список у localStorage.

(function(){
  'use strict';

  // ==================== ANNOUNCEMENTS ====================
  
  function saveAnnouncement(activate) {
    var data = {
      id: document.getElementById('ann-id').value || null,
      title: document.getElementById('ann-title').value.trim(),
      body: document.getElementById('ann-body').value.trim(),
      image_url: document.getElementById('ann-image').value.trim(),
      btn_text: document.getElementById('ann-btn-text').value.trim(),
      btn_url: document.getElementById('ann-btn-url').value.trim(),
      active: !!activate
    };
    if (!data.title && !data.body) return alert('Заповніть заголовок або текст');
    fetch('/api/admin/announcements', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(data) })
      .then(function(r){ return r.json(); }).then(function(d){
        if (d.ok) {
          clearAnnouncementForm();
          loadAdminAnnouncements();
          alert(activate ? '📢 Оголошення опубліковано!' : '💾 Чернетку збережено');
        } else alert(d.error || 'Помилка');
      }).catch(function(){ alert('Помилка мережі'); });
  }
  
  function clearAnnouncementForm() {
    document.getElementById('ann-id').value = '';
    document.getElementById('ann-title').value = '';
    document.getElementById('ann-body').value = '';
    document.getElementById('ann-image').value = '';
    document.getElementById('ann-btn-text').value = '';
    document.getElementById('ann-btn-url').value = '';
    document.getElementById('ann-preview').innerHTML = '';
  }
  
  function editAnnouncement(id) {
    fetch('/api/admin/announcements').then(function(r){return r.json()}).then(function(list){
      var a = list.find(function(x){return x.id===id});
      if (!a) return;
      document.getElementById('ann-id').value = a.id;
      document.getElementById('ann-title').value = a.title || '';
      document.getElementById('ann-body').value = a.body || '';
      document.getElementById('ann-image').value = a.image_url || '';
      document.getElementById('ann-btn-text').value = a.btn_text || '';
      document.getElementById('ann-btn-url').value = a.btn_url || '';
      // Scroll to form
      document.getElementById('ann-title').scrollIntoView({behavior:'smooth', block:'center'});
      document.getElementById('ann-title').focus();
    });
  }
  
  function deleteAnnouncement(id) {
    if (!confirm('Видалити це оголошення?')) return;
    fetch('/api/admin/announcements/delete', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({id:id}) })
      .then(function(r){return r.json()}).then(function(d){
        if (d.ok) loadAdminAnnouncements();
      });
  }
  
  function toggleAnnouncement(id, activate) {
    fetch('/api/admin/announcements').then(function(r){return r.json()}).then(function(list){
      var a = list.find(function(x){return x.id===id});
      if (!a) return;
      a.active = activate;
      return fetch('/api/admin/announcements', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(a) });
    }).then(function(r){return r.json()}).then(function(d){
      if (d.ok) loadAdminAnnouncements();
    });
  }
  
  function loadAdminAnnouncements() {
    fetch('/api/admin/announcements').then(function(r){return r.json()}).then(function(list){
      var el = document.getElementById('ann-list');
      if (!list.length) { el.innerHTML = '<p class="text-muted" style="font-size:13px;">Оголошень ще немає</p>'; return; }
      el.innerHTML = list.map(function(a){
        var statusBadge = a.active
          ? '<span style="background:#D1FAE5;color:#065F46;padding:2px 8px;border-radius:6px;font-size:11px;font-weight:600;">🟢 Активне</span>'
          : '<span style="background:#F3F4F6;color:#6B7280;padding:2px 8px;border-radius:6px;font-size:11px;">Чернетка</span>';
        var imgPreview = a.image_url ? '<img src="'+esc(a.image_url)+'" style="width:48px;height:48px;object-fit:cover;border-radius:6px;margin-right:10px;">' : '';
        var date = a.created_at ? new Date(a.created_at).toLocaleDateString('uk') : '';
        return '<div style="display:flex;align-items:center;gap:10px;padding:10px 12px;background:var(--bg);border-radius:8px;margin-bottom:8px;">' +
          imgPreview +
          '<div style="flex:1;min-width:0;">' +
            '<div style="font-weight:600;font-size:14px;">'+esc(a.title||'(без заголовка)')+'</div>' +
            '<div style="font-size:12px;color:var(--text-light);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:300px;">'+esc((a.body||'').slice(0,80))+'</div>' +
          '</div>' +
          '<div style="display:flex;align-items:center;gap:6px;flex-shrink:0;">' +
            statusBadge +
            '<span style="font-size:11px;color:var(--text-light);">'+date+'</span>' +
            (a.active
              ? '<button class="btn btn-outline btn-sm" onclick="toggleAnnouncement('+a.id+',false)" title="Деактивувати" style="padding:4px 8px;">⏸</button>'
              : '<button class="btn btn-outline btn-sm" onclick="toggleAnnouncement('+a.id+',true)" title="Активувати" style="padding:4px 8px;">▶️</button>') +
            '<button class="btn btn-outline btn-sm" onclick="editAnnouncement('+a.id+')" title="Редагувати" style="padding:4px 8px;">✏️</button>' +
            '<button class="btn btn-outline btn-sm" onclick="deleteAnnouncement('+a.id+')" title="Видалити" style="padding:4px 8px;color:#DC2626;">✕</button>' +
          '</div></div>';
      }).join('');
    }).catch(function(){});
  }
  
  // ---- User-facing announcement popup ----
  function checkAnnouncement() {
    fetch('/api/announcement').then(function(r){return r.json()}).then(function(d){
      if (!d.announcement) return;
      var a = d.announcement;
      // Check if user already dismissed this announcement
      var dismissed = JSON.parse(localStorage.getItem('lipo_dismissed_ann') || '[]');
      if (dismissed.indexOf(a.id) !== -1) return;
      showAnnouncementPopup(a);
    }).catch(function(){});
  }
  
  function showAnnouncementPopup(a) {
    var popup = document.getElementById('announcement-popup');
    var imgEl = document.getElementById('ann-popup-img');
    var titleEl = document.getElementById('ann-popup-title');
    var textEl = document.getElementById('ann-popup-text');
    var btnEl = document.getElementById('ann-popup-btn');
  
    if (a.image_url) {
      imgEl.src = a.image_url;
      imgEl.style.display = 'block';
    } else {
      imgEl.style.display = 'none';
    }
  
    titleEl.textContent = a.title || '';
    textEl.textContent = a.body || '';
  
    if (a.btn_text && a.btn_url) {
      btnEl.textContent = a.btn_text;
      btnEl.href = a.btn_url;
      btnEl.style.display = 'inline-block';
    } else {
      btnEl.style.display = 'none';
    }
  
    popup.dataset.annId = a.id;
    popup.style.display = 'block';
  }
  
  function dismissAnnouncement() {
    var popup = document.getElementById('announcement-popup');
    var id = Number(popup.dataset.annId);
    popup.style.display = 'none';
    // Remember dismissed
    var dismissed = JSON.parse(localStorage.getItem('lipo_dismissed_ann') || '[]');
    if (dismissed.indexOf(id) === -1) dismissed.push(id);
    // Keep only last 50 dismissed IDs
    if (dismissed.length > 50) dismissed = dismissed.slice(-50);
    localStorage.setItem('lipo_dismissed_ann', JSON.stringify(dismissed));
  }

  window.saveAnnouncement = saveAnnouncement;
  window.clearAnnouncementForm = clearAnnouncementForm;
  window.editAnnouncement = editAnnouncement;
  window.deleteAnnouncement = deleteAnnouncement;
  window.toggleAnnouncement = toggleAnnouncement;
  window.loadAdminAnnouncements = loadAdminAnnouncements;
  window.checkAnnouncement = checkAnnouncement;
  window.showAnnouncementPopup = showAnnouncementPopup;
  window.dismissAnnouncement = dismissAnnouncement;
})();
