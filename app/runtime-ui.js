/* PrintGuard - small runtime UI adapters (loaded before app.js) */
'use strict';

(function attachPrintGuardRuntimeUI(global) {
  function createRuntimeUI(deps) {
    const { cfg, t } = deps;

    function getCostUnitPerM2() {
      return `${cfg.costCurrency} / m²`;
    }

    function getCostUnitPerMonth() {
      return `${cfg.costCurrency} / ${t('unit.month-word')}`;
    }

    return {
      getCostUnitPerM2,
      getCostUnitPerMonth,
    };
  }

  global.PrintGuardRuntimeUI = { createRuntimeUI };
})(window);
