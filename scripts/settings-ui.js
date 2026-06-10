(function attachPrintGuardSettingsUI(global) {
  'use strict';

  function loadSettingsUI(deps) {
    const { APP_VERSION, cfg, el } = deps;
    el('cfg-weeks').value = cfg.weeksN;
    el('cfg-n').value = cfg.rollingN;
    el('cfg-ink-cost').value = cfg.inkCost || '';
    el('cfg-media-cost').value = cfg.mediaCost || '';
    el('cfg-cost-currency').value = cfg.costCurrency;
    if (el('cfg-theme')) el('cfg-theme').value = cfg.theme || 'light';
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
      resetLocalStockCache,
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
      if (el('cfg-theme')) cfg.theme = el('cfg-theme').value || 'light';
      cfg.userName = (el('cfg-user-name').value || '').trim();
      await saveSettingsToIDB();
      renderStockOverview();
      renderCoDashboard();
      renderCoHistory();
      showToast(i18n('settings.toast.saved'), 'success');
    });

    if (el('cfg-theme')) {
      el('cfg-theme').addEventListener('change', (event) => {
        cfg.theme = event.target.value || 'light';
      });
    }

    el('enable-push-btn').addEventListener('click', () => {
      enablePushNotifications();
    });

    el('send-test-push-btn').addEventListener('click', async () => {
      try {
        const res = await fetchImpl('/.netlify/functions/send-test-push', {
          method: 'POST',
        });

        let result = null;
        try {
          result = await res.json();
        } catch (_) {}

        if (!res.ok || !result?.ok) {
          throw new Error(result?.error || 'Odeslání test notifikace selhalo.');
        }

        showToast(
          `Test notifikace: odesláno ${result.sent || 0}, selhalo ${result.failed || 0}.`,
          'success',
        );
      } catch (error) {
        console.error('[Push] send test failed', error);
        showToast(
          error?.message || 'Odeslání test notifikace selhalo.',
          'error',
        );
      }
    });

    el('send-stock-alerts-btn').addEventListener('click', async () => {
      await sendStockNotifications({
        silent: false,
        trigger: 'manual-settings',
      });
    });

    el('export-csv-intervals').addEventListener('click', exportCSVIntervals);
    el('export-csv-raw-co').addEventListener('click', exportCSVRawCo);
    el('export-csv-stock').addEventListener('click', exportCSVStock);
    el('export-csv-stock-levels').addEventListener(
      'click',
      exportCSVStockLevels,
    );
    el('export-json').addEventListener('click', exportJSON);
    el('import-json-btn').addEventListener('click', () =>
      el('import-json-input').click(),
    );
    el('import-json-input').addEventListener('change', handleImportJSON);

    el('reset-stock-cache-btn')?.addEventListener('click', () => {
      showConfirm(
        'Resetovat lokální cache skladu na tomto zařízení?',
        async () => {
          if (typeof resetLocalStockCache === 'function') {
            await resetLocalStockCache();
          } else {
            await Promise.all([idbClear(ST_ITEMS), idbClear(ST_MOVES)]);
            S.items = [];
            S.movements = [];
          }
          renderStockOverview();
          renderAlerts();
          renderItemsMgmt();
          showToast(
            'Lokální cache skladu byla resetována. Spusťte Sync pro načtení DB stavu.',
          );
        },
      );
    });

    el('clear-all-btn').addEventListener('click', () => {
      showConfirm(i18n('settings.clear.confirm'), async () => {
        await Promise.all([
          idbClear(ST_ITEMS),
          idbClear(ST_MOVES),
          idbClear(ST_CORECS),
          idbClear(ST_SETTINGS),
        ]);
        try {
          localStorage.removeItem('pg_stock_action_queue_v1');
          localStorage.removeItem('pg_sync_dirty_reasons');
          localStorage.removeItem('pg_sync_dirty_version');
        } catch (_) {}
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
