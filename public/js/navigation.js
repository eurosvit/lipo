// ============================================================
// LipoLand — Navigation + Modals module (SYNC)
// ============================================================
// showPage, renderPage, mobile menu toggle, openModal/closeModal.
// SYNC (без defer): showPage викликається з db.js init-fetch.

(function(){
  'use strict';

  // ---------- MOBILE MENU ----------
  function toggleMobileMenu() {
    document.getElementById('mobile-menu').classList.toggle('show');
  }
  function closeMobileMenu() {
    document.getElementById('mobile-menu').classList.remove('show');
  }
  function mobileNav(id) {
    closeMobileMenu();
    showPage(id);
  }

  // ---------- NAVIGATION ----------
  function showPage(id) {
    document.querySelectorAll('.page').forEach(function(p){ p.classList.remove('active'); });
    document.querySelectorAll('.nav-links button').forEach(function(b){ b.classList.remove('active'); });
    var el = document.getElementById(id);
    if (el) el.classList.add('active');
    var activeBtn = document.querySelector('.nav-links button[data-page="'+id+'"]');
    if (activeBtn) {
      activeBtn.classList.add('active');
      activeBtn.scrollIntoView({ behavior:'smooth', block:'nearest', inline:'center' });
    }
    localStorage.setItem('lipo_current_page', id);
    renderPage(id);
  }

  function renderPage(id) {
    // Усі render-функції — з defer-модулів. Завантажуються після парсингу HTML.
    var fn = {
      dashboard: window.renderDashboard,
      materials: window.renderMaterials,
      products: window.renderProducts,
      production: window.renderProduction,
      orders: window.renderOrders,
      clients: window.renderClients,
      'worker-stock': window.renderWorkerStock,
      salary: window.renderSalary,
      expenses: window.renderExpenses,
      equipment: window.renderEquipment,
      analytics: window.renderAnalytics,
      audit: window.renderAuditLog,
      admin: window.renderAdmin,
      settings: window.renderSettings
    };
    if (id === 'analytics') {
      var anFrom = document.getElementById('an-from');
      if (anFrom && !anFrom.value && typeof window.setAnalyticsPeriod === 'function') {
        window.setAnalyticsPeriod('6m');
      }
    }
    if (typeof fn[id] === 'function') fn[id]();
  }

  // ---------- MODALS ----------
  function openModal(name) {
    document.getElementById('modal-'+name).classList.add('show');
    if (name === 'receive-material' && typeof window.populateReceiveMat === 'function') window.populateReceiveMat();
    if (name === 'add-product' && typeof window.populateCategorySelects === 'function') {
      window.populateCategorySelects();
      var recip = document.getElementById('prod-recipe');
      if (recip) recip.innerHTML = '';
      if (typeof window.addRecipeLine === 'function') window.addRecipeLine();
    }
    if (name === 'start-production' && typeof window.populateStartProd === 'function') window.populateStartProd();
    if (name === 'complete-production' && typeof window.populateCompleteProd === 'function') window.populateCompleteProd();
    if (name === 'add-order') {
      var po = document.getElementById('ord-payment'); if (po) po.value = '';
      var ps = document.getElementById('ord-payment-status'); if (ps) ps.value = 'unpaid';
      if (typeof window.toggleOrdDeliveryFields === 'function') window.toggleOrdDeliveryFields('ord');
      if (typeof window.populateOrderChannelSelect === 'function') window.populateOrderChannelSelect('ord-channel');
    }
    if (name === 'transfer-to-worker' && typeof window.populateTransferModal === 'function') window.populateTransferModal();
  }

  function closeModal(name) {
    document.getElementById('modal-'+name).classList.remove('show');
  }

  // Export
  window.toggleMobileMenu = toggleMobileMenu;
  window.closeMobileMenu = closeMobileMenu;
  window.mobileNav = mobileNav;
  window.showPage = showPage;
  window.renderPage = renderPage;
  window.openModal = openModal;
  window.closeModal = closeModal;
})();
