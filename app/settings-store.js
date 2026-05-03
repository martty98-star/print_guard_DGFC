/* PrintGuard - settings IndexedDB persistence (loaded before app.js) */
'use strict';

(function attachPrintGuardSettingsStore(global) {
  const AppConfig = global.PrintGuardAppConfig;
  if (!AppConfig) throw new Error('Missing PrintGuardAppConfig');
  const { cfg } = AppConfig;

  const AppDB = global.PrintGuardAppDB;
  if (!AppDB) throw new Error('Missing PrintGuardAppDB');
  const { ST_SETTINGS, idbAll, idbPut } = AppDB;

  async function saveSettingsToIDB() {
    await idbPut(ST_SETTINGS, {
      key: 'config',
      weeksN: cfg.weeksN,
      rollingN: cfg.rollingN,
      inkCost: cfg.inkCost,
      mediaCost: cfg.mediaCost,
      costCurrency: cfg.costCurrency,
      theme: cfg.theme,
      savedAt: new Date().toISOString(),
    });
  }

  async function loadSettingsFromIDB() {
    const all = await idbAll(ST_SETTINGS);
    const rec = all.find(r => r.key === 'config');
    if (!rec) return;
    if (rec.weeksN != null) cfg.weeksN = rec.weeksN;
    if (rec.rollingN != null) cfg.rollingN = rec.rollingN;
    if (rec.inkCost != null) cfg.inkCost = rec.inkCost;
    if (rec.mediaCost != null) cfg.mediaCost = rec.mediaCost;
    if (rec.costCurrency != null) cfg.costCurrency = rec.costCurrency;
    if (rec.theme != null) cfg.theme = rec.theme;
  }

  global.PrintGuardSettingsStore = {
    loadSettingsFromIDB,
    saveSettingsToIDB,
  };
})(typeof window !== 'undefined' ? window : globalThis);
