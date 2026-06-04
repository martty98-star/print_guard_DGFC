/* PrintGuard - app bootstrap lifecycle orchestration (loaded before app.js) */
'use strict';

(function attachPrintGuardAppLifecycle(global) {
  function createAppLifecycle(deps) {
    const {
      ChecklistUI,
      adminErrorMessage,
      adminHeaders,
      appFetch,
      applyRoleUI,
      bindColoradoHistoryControls,
      bindPostPurchaseControls,
      bindPrintLogControls,
      bindShellControls,
      cfg,
      el,
      enablePushNotifications,
      exportCSVCurrentMonthCo,
      exportCSVPrintLog,
      exportCSVRawCo,
      getInitialScreen,
      i18n,
      initPostPurchaseRuntime,
      initSettingsRuntime,
      initStockFeature,
      loadAll,
      loadColoradoRollEvents,
      loadColoradoRollStates,
      navigate,
      openDB,
      renderAlerts,
      renderChecklistScreen,
      renderCoDashboard,
      renderCoHistory,
      renderItemsMgmt,
      renderPostPurchaseOrders,
      renderPrintLogRows,
      renderStockLog,
      renderStockOverview,
      setDb,
      setupAdminAuthHandlers,
      setupAppUpdateChecks,
      setupBackgroundSync,
      setupCoEntry,
      showConfirm,
      showPendingUpdateToast,
      showToast,
      state,
      storage,
    } = deps;

    function handleI18nChanged() {
      const costCurrencySelect = el('cfg-cost-currency');
      if (costCurrencySelect && !storage('pg_cost_currency')) {
        costCurrencySelect.value = cfg.costCurrency;
      }
      try { renderStockOverview(); } catch (_) {}
      try { renderAlerts(); } catch (_) {}
      try { renderItemsMgmt(); } catch (_) {}
      try { renderStockLog(); } catch (_) {}
      try { renderCoDashboard(); } catch (_) {}
      try { renderCoHistory(); } catch (_) {}
      try { renderPrintLogRows(); } catch (_) {}
      try { renderPostPurchaseOrders(); } catch (_) {}
      try { renderChecklistScreen(false); } catch (_) {}
    }

    async function init() {
      if (global.I18N && typeof global.I18N.init === 'function') {
        global.I18N.init();
      }
      setDb(await openDB());
      state.coloradoRolls = loadColoradoRollStates();
      state.coloradoRollEvents = loadColoradoRollEvents();
      bindShellControls();

      initStockFeature();
      setupCoEntry();
      bindColoradoHistoryControls({
        exportCSVCurrentMonthCo,
        exportCSVRawCo,
      });
      ChecklistUI.initChecklistUI({
        applyRoleUI,
        adminErrorMessage,
        adminHeaders,
        cfg,
        el,
        fetchImpl: appFetch,
        i18n,
        showConfirm,
        showToast,
      });
      initSettingsRuntime();
      initPostPurchaseRuntime();
      bindPostPurchaseControls();
      bindPrintLogControls({
        exportCSVPrintLog,
      });
      setupAdminAuthHandlers();

      await loadAll();
      applyRoleUI();
      setupBackgroundSync();
      showPendingUpdateToast();

      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('sw.js')
          .then((registration) => {
            registration.update().catch(() => {});
          })
          .catch((error) => console.warn('[SW]', error));
        setupAppUpdateChecks();
      }

      navigate(getInitialScreen(), { replace: true });
      applyRoleUI();
    }

    function bindLifecycleEvents() {
      global.enablePushNotifications = enablePushNotifications;
      global.addEventListener('i18n:changed', handleI18nChanged);
      document.addEventListener('DOMContentLoaded', init);
    }

    return {
      bindLifecycleEvents,
      handleI18nChanged,
      init,
    };
  }

  global.PrintGuardAppLifecycle = { createAppLifecycle };
})(window);
