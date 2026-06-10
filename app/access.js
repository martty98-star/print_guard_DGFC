/* PrintGuard - screen access guards and gated empty states (loaded before app.js) */
'use strict';

(function attachPrintGuardAccess(global) {
  function createAccessGuards(deps) {
    const { cfg, el, elSet, showToast, t } = deps;

    function requireAdminPinForScreen(statusId, wrapId) {
      if (cfg.adminPin) return true;

      if (statusId) elSet(statusId, 'Admin PIN required');
      const wrap = wrapId ? el(wrapId) : null;
      if (wrap) {
        wrap.innerHTML =
          '<div class="empty-state"><div class="empty-state-icon">⚠</div><p>Admin PIN is required for this action.</p><div class="table-empty-note">Open Settings, enter the admin PIN, and unlock admin mode.</div></div>';
      }
      showToast('Admin PIN is required for this action.', 'error');
      return false;
    }

    function renderPostPurchaseAccessRequired() {
      elSet('postpurchase-status', t('processed.status.pin-required'));
      const wrap = el('postpurchase-orders-wrap');
      if (wrap) {
        wrap.innerHTML = `<div class="empty-state"><div class="empty-state-icon">⚠</div><p>${t('processed.pin.required')}</p><div class="table-empty-note">${t('processed.pin.required-note')}</div></div>`;
      }
    }

    function requirePostPurchasePinForScreen() {
      if (cfg.postPurchasePin || cfg.adminPin) return true;
      renderPostPurchaseAccessRequired();
      showToast(
        t('processed.pin.required') || 'Processed Orders PIN is required.',
        'error',
      );
      return false;
    }

    return {
      renderPostPurchaseAccessRequired,
      requireAdminPinForScreen,
      requirePostPurchasePinForScreen,
    };
  }

  global.PrintGuardAccess = { createAccessGuards };
})(window);
