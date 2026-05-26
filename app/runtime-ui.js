/* PrintGuard - small runtime UI adapters (loaded before app.js) */
'use strict';

(function attachPrintGuardRuntimeUI(global) {
  function createRuntimeUI(deps) {
    const {
      APP_VERSION,
      cfg,
      el,
      loadSettingsUIScreen,
      t,
    } = deps;

    function getCostUnitPerM2() {
      return `${cfg.costCurrency} / m²`;
    }

    function getCostUnitPerMonth() {
      return `${cfg.costCurrency} / ${t('unit.month-word')}`;
    }

    function loadSettingsUI() {
      return loadSettingsUIScreen({ APP_VERSION, cfg, el });
    }

    return {
      getCostUnitPerM2,
      getCostUnitPerMonth,
      loadSettingsUI,
    };
  }

  global.PrintGuardRuntimeUI = { createRuntimeUI };
})(window);
