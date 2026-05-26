/* PrintGuard - PostPurchase runtime composition (loaded before app.js) */
'use strict';

(function attachPrintGuardPostPurchaseRuntime(global) {
  const PostPurchaseUI = global.PrintGuardPostPurchaseUI;

  if (!PostPurchaseUI) {
    throw new Error('Missing PrintGuardPostPurchaseUI');
  }

  function createPostPurchaseRuntime(deps) {
    const {
      S,
      adminJsonHeaders,
      applyRoleUI,
      cfg,
      el,
      elSet,
      esc,
      fetchImpl,
      fmtDT,
      postPurchaseErrorMessage,
      postPurchaseHeaders,
      postPurchaseJsonHeaders,
      renderPostPurchaseAccessRequired,
      requirePostPurchasePinForScreen,
      showToast,
    } = deps || {};

    function loadPostPurchaseOrders(force = false, options) {
      return PostPurchaseUI.loadPostPurchaseOrders(force, options);
    }

    function renderPostPurchaseOrders() {
      return PostPurchaseUI.renderPostPurchaseOrders();
    }

    function syncPostPurchaseOrdersManual() {
      return PostPurchaseUI.syncPostPurchaseOrdersManual();
    }

    function initRuntime() {
      PostPurchaseUI.initPostPurchaseUI({
        S,
        adminJsonHeaders,
        applyRoleUI,
        cfg,
        el,
        elSet,
        esc,
        fetchImpl,
        fmtDT,
        postPurchaseErrorMessage,
        postPurchaseHeaders,
        postPurchaseJsonHeaders,
        renderPostPurchaseAccessRequired,
        requirePostPurchasePinForScreen,
        showToast,
      });
    }

    function bindControls() {
      return PostPurchaseUI.bindPostPurchaseControls();
    }

    return {
      bindControls,
      initRuntime,
      loadPostPurchaseOrders,
      renderPostPurchaseOrders,
      syncPostPurchaseOrdersManual,
    };
  }

  global.PrintGuardPostPurchaseRuntime = {
    createPostPurchaseRuntime,
  };
})(window);
