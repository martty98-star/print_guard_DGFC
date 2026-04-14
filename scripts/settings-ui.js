(function attachPrintGuardSettingsUI(global) {
  'use strict';

  function loadSettingsUI(deps) {
    const { APP_VERSION, cfg, el } = deps;
    el('cfg-weeks').value = cfg.weeksN;
    el('cfg-n').value = cfg.rollingN;
    el('cfg-ink-cost').value = cfg.inkCost || '';
    el('cfg-media-cost').value = cfg.mediaCost || '';
    el('cfg-cost-currency').value = cfg.costCurrency;
    if (el('cfg-user-name')) el('cfg-user-name').value = cfg.userName || '';
    el('device-id-display').textContent = cfg.deviceId;
    el('app-version-display').textContent = APP_VERSION;
  }

  function setupSettings(deps) {
    const {
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

    el('save-settings-btn').addEventListener('click', async () => {
      cfg.weeksN = parseInt(el('cfg-weeks').value, 10) || 8;
      cfg.rollingN = parseInt(el('cfg-n').value, 10) || 8;
      cfg.inkCost = parseFloat(el('cfg-ink-cost').value) || 0;
      cfg.mediaCost = parseFloat(el('cfg-media-cost').value) || 0;
      cfg.costCurrency = el('cfg-cost-currency').value || cfg.costCurrency;
      cfg.userName = (el('cfg-user-name').value || '').trim();
      await saveSettingsToIDB();
      renderStockOverview();
      renderCoDashboard();
      renderCoHistory();
      showToast(i18n('settings.toast.saved'), 'success');
    });

    el('enable-push-btn').addEventListener('click', () => {
      enablePushNotifications();
    });

    el('send-test-push-btn').addEventListener('click', async () => {
      try {
        const res = await fetchImpl('/.netlify/functions/send-test-push', {
          method: 'POST',
        });

        let result = null;
        try { result = await res.json(); } catch (_) {}

        if (!res.ok || !result?.ok) {
          throw new Error(result?.error || 'Odeslání test notifikace selhalo.');
        }

        showToast(`Test notifikace: odesláno ${result.sent || 0}, selhalo ${result.failed || 0}.`, 'success');
      } catch (error) {
        console.error('[Push] send test failed', error);
        showToast(error?.message || 'Odeslání test notifikace selhalo.', 'error');
      }
    });

    el('send-stock-alerts-btn').addEventListener('click', async () => {
      await sendStockNotifications({ silent: false, trigger: 'manual-settings' });
    });

    el('export-csv-intervals').addEventListener('click', exportCSVIntervals);
    el('export-csv-raw-co').addEventListener('click', exportCSVRawCo);
    el('export-csv-stock').addEventListener('click', exportCSVStock);
    el('export-csv-stock-levels').addEventListener('click', exportCSVStockLevels);
    el('export-json').addEventListener('click', exportJSON);
    el('import-json-btn').addEventListener('click', () => el('import-json-input').click());
    el('import-json-input').addEventListener('change', handleImportJSON);

    el('clear-all-btn').addEventListener('click', () => {
      showConfirm(i18n('settings.clear.confirm'), async () => {
        await Promise.all([idbClear(ST_ITEMS), idbClear(ST_MOVES), idbClear(ST_CORECS), idbClear(ST_SETTINGS)]);
        S.items = [];
        S.movements = [];
        S.coRecords = [];
        renderStockOverview();
        renderAlerts();
        renderItemsMgmt();
        renderCoDashboard();
        renderCoHistory();
        showToast(i18n('settings.clear.done'));
      });
    });
  }

  global.PrintGuardSettingsUI = {
    loadSettingsUI,
    setupSettings,
  };
})(window);
