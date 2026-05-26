/* PrintGuard - settings runtime composition (loaded before app.js) */
'use strict';

(function attachPrintGuardSettingsRuntime(global) {
  const SettingsUI = global.PrintGuardSettingsUI;

  if (!SettingsUI) {
    throw new Error('Missing PrintGuardSettingsUI');
  }

  function createSettingsRuntime(deps) {
    const {
      APP_VERSION,
      ST_CORECS,
      ST_ITEMS,
      ST_MOVES,
      ST_SETTINGS,
      S,
      cfg,
      el,
      enablePushNotifications,
      exportCSVIntervals,
      exportCSVRawCo,
      exportCSVStock,
      exportCSVStockLevels,
      exportJSON,
      fetchImpl,
      handleImportJSON,
      i18n,
      idbClear,
      renderAlerts,
      renderCoDashboard,
      renderCoHistory,
      renderItemsMgmt,
      renderStockOverview,
      saveSettingsToIDB,
      sendStockNotifications,
      showConfirm,
      showToast,
    } = deps;

    function loadSettingsUI() {
      return SettingsUI.loadSettingsUI({ APP_VERSION, cfg, el });
    }

    function initRuntime() {
      return SettingsUI.setupSettings({
        ST_CORECS,
        ST_ITEMS,
        ST_MOVES,
        ST_SETTINGS,
        S,
        cfg,
        el,
        enablePushNotifications,
        exportCSVIntervals,
        exportCSVRawCo,
        exportCSVStock,
        exportCSVStockLevels,
        exportJSON,
        fetchImpl,
        handleImportJSON,
        i18n,
        idbClear,
        renderAlerts,
        renderCoDashboard,
        renderCoHistory,
        renderItemsMgmt,
        renderStockOverview,
        saveSettingsToIDB,
        sendStockNotifications,
        showConfirm,
        showToast,
      });
    }

    return {
      initRuntime,
      loadSettingsUI,
    };
  }

  global.PrintGuardSettingsRuntime = {
    createSettingsRuntime,
  };
})(window);
