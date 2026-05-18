/* PrintGuard — admin role helpers (loaded before app.js) */
'use strict';

(function attachPrintGuardAdminAuth(global) {
  function createAdminAuth(deps) {
    const { cfg, el, navigate, showToast } = deps;

    function isAdmin() {
      return cfg.role === 'admin' && Boolean(cfg.adminPin);
    }

    function applyRoleUI() {
      const admin = isAdmin();
      const itemsBtn = document.querySelector('#stock-nav .nav-item[data-screen="stock-items"]');
      if (itemsBtn) itemsBtn.style.display = admin ? '' : 'none';
      const addBtn = el('add-item-btn');
      if (addBtn) addBtn.style.display = admin ? '' : 'none';
      document.querySelectorAll('.admin-only').forEach(node => {
        node.style.display = admin ? '' : 'none';
      });
      if (!admin) {
        const itemsScreen = el('screen-stock-items');
        if (itemsScreen?.classList.contains('active')) navigate('stock-overview');
      }
    }

    function setupAdminAuthHandlers() {
      el('admin-unlock-btn')?.addEventListener('click', () => {
        const pin = (el('admin-pin')?.value || '').trim();
        if (!pin) { showToast('Zadejte PIN', 'error'); return; }
        cfg.adminPin = pin;
        cfg.role = 'admin';
        if (el('admin-pin')) el('admin-pin').value = '';
        applyRoleUI();
        showToast('Admin režim odemčen', 'success');
      });

      el('admin-lock-btn')?.addEventListener('click', () => {
        cfg.adminPin = '';
        cfg.role = 'operator';
        applyRoleUI();
        showToast('Operator režim aktivní', 'success');
      });
    }

    return { applyRoleUI, isAdmin, setupAdminAuthHandlers };
  }

  global.PrintGuardAdminAuth = { createAdminAuth };
})(window);
