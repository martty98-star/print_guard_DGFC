import { createCore } from './modules/core.js';
import { createStockModule } from './modules/stock.js';
import { createColoradoModule } from './modules/colorado.js';
import { createPrintLogModule } from './modules/print-log.js';

const core = createCore();
const stock = createStockModule(core);
const colorado = createColoradoModule(core);
const printLog = createPrintLogModule(core);

core.setModules({ stock, colorado, printLog });

const { cfg, S } = core;

async function init() {
  await core.openDB();

  document.querySelectorAll('.mode-btn').forEach(b =>
    b.addEventListener('click', () => core.setMode(b.dataset.mode)));

  document.querySelectorAll('#stock-nav .nav-item, #colorado-nav .nav-item').forEach(b =>
    b.addEventListener('click', () => core.navigate(b.dataset.screen)));

  document.querySelectorAll('.back-btn').forEach(b =>
    b.addEventListener('click', () => core.navigate(b.dataset.screen || 'stock-overview')));

  core.el('fab-movement').addEventListener('click', () => core.navigate('stock-movement'));
  core.el('fab-co-entry').addEventListener('click', () => core.navigate('co-entry'));
  core.el('nav-settings').addEventListener('click', () => core.navigate('settings'));

  core.el('sync-btn').addEventListener('click', async () => {
    await core.runSync();
  });

  core.el('stock-search').addEventListener('input', e => {
    S.stockSearch = e.target.value;
    stock.renderStockOverview();
  });
  document.querySelectorAll('.pill').forEach(p =>
    p.addEventListener('click', () => {
      document.querySelectorAll('.pill').forEach(pp => pp.classList.remove('active'));
      p.classList.add('active');
      S.stockFilter = p.dataset.filter;
      stock.renderStockOverview();
    }));
  document.querySelectorAll('.stat-chip').forEach(chip =>
    chip.addEventListener('click', () => {
      const f = chip.dataset.filter;
      document.querySelectorAll('.pill').forEach(p => p.classList.toggle('active', p.dataset.filter === f));
      S.stockFilter = f;
      stock.renderStockOverview();
    }));

  core.el('add-item-btn').addEventListener('click', () => stock.openItemModal(null));
  core.el('item-modal-close').addEventListener('click', () => core.el('item-modal').classList.add('hidden'));
  core.el('item-modal-cancel').addEventListener('click', () => core.el('item-modal').classList.add('hidden'));
  core.el('item-modal-save').addEventListener('click', stock.saveItemModal);

  document.querySelectorAll('.hist-tab').forEach(b =>
    b.addEventListener('click', () => {
      S.coHistMachine = b.dataset.machine;
      colorado.renderCoHistory();
    }));

  stock.setupMovementEntry();
  colorado.setupCoEntry();
  core.setupSettings();

  core.el('stock-log-search').addEventListener('input', e => {
    S.logSearch = e.target.value;
    stock.renderStockLog();
  });
  document.querySelectorAll('[data-logfilter]').forEach(p =>
    p.addEventListener('click', () => {
      document.querySelectorAll('[data-logfilter]').forEach(pp => pp.classList.remove('active'));
      p.classList.add('active');
      S.logFilter = p.dataset.logfilter;
      stock.renderStockLog();
    }));
  core.el('stock-log-export-btn').addEventListener('click', stock.exportCSVStockLog);

  core.el('stock-log-from').addEventListener('change', e => { S.logDateFrom = e.target.value; stock.renderStockLog(); });
  core.el('stock-log-to').addEventListener('change', e => { S.logDateTo = e.target.value; stock.renderStockLog(); });
  core.el('stock-log-clear-dates').addEventListener('click', () => {
    S.logDateFrom = '';
    S.logDateTo = '';
    core.el('stock-log-from').value = '';
    core.el('stock-log-to').value = '';
    stock.renderStockLog();
  });

  core.el('co-hist-from').addEventListener('change', e => { S.coDateFrom = e.target.value; colorado.renderCoHistory(); });
  core.el('co-hist-to').addEventListener('change', e => { S.coDateTo = e.target.value; colorado.renderCoHistory(); });
  core.el('co-hist-clear-dates').addEventListener('click', () => {
    S.coDateFrom = '';
    S.coDateTo = '';
    core.el('co-hist-from').value = '';
    core.el('co-hist-to').value = '';
    colorado.renderCoHistory();
  });
  core.el('co-history-export-btn').addEventListener('click', core.exportCSVRawCo);

  core.el('print-log-from').addEventListener('change', e => { S.printLogDateFrom = e.target.value; printLog.loadPrintLog(true); });
  core.el('print-log-to').addEventListener('change', e => { S.printLogDateTo = e.target.value; printLog.loadPrintLog(true); });
  core.el('print-log-view-mode').addEventListener('change', e => {
    S.printLogViewMode = e.target.value || 'raw';
    const isGrouped = S.printLogViewMode === 'grouped';
    core.el('print-log-group-filter-wrap')?.classList.toggle('hidden', !isGrouped);
    core.elSet('print-log-table-title', isGrouped ? 'Rešení problému / SLA' : 'Poslední tiskové aktivity');
    printLog.renderPrintLogRows();
  });
  core.el('print-log-printer').addEventListener('change', e => { S.printLogPrinter = e.target.value; printLog.loadPrintLog(true); });
  core.el('print-log-result').addEventListener('change', e => { S.printLogResult = e.target.value; printLog.loadPrintLog(true); });
  core.el('print-log-group-filter').addEventListener('change', e => {
    S.printLogGroupFilter = e.target.value || 'all';
    printLog.renderPrintLogRows();
  });
  core.el('print-log-clear-dates').addEventListener('click', () => {
    S.printLogDateFrom = '';
    S.printLogDateTo = '';
    core.el('print-log-from').value = '';
    core.el('print-log-to').value = '';
    printLog.loadPrintLog(true);
  });
  core.el('print-log-refresh-btn').addEventListener('click', () => {
    printLog.loadPrintLog(true);
  });
  document.addEventListener('click', e => {
    const groupRow = e.target?.closest?.('.pl-group-row[data-group-id]');
    if (groupRow) {
      const id = groupRow.dataset.groupId;
      S.printLogExpandedGroups[id] = !S.printLogExpandedGroups[id];
      printLog.renderPrintLogRows();
      return;
    }
    if (e.target?.id === 'pl-load-more') {
      printLog.loadPrintLog(false);
    }
  });

  document.querySelectorAll('.dr-preset').forEach(btn =>
    btn.addEventListener('click', () => core.applyPreset(btn.dataset.range, btn.dataset.target)));

  core.el('admin-unlock-btn')?.addEventListener('click', () => {
    const pin = (core.el('admin-pin')?.value || '').trim();
    if (!pin) { core.showToast('Zadejte PIN', 'error'); return; }
    if (pin !== cfg.adminPin) { core.showToast('Špatný PIN', 'error'); return; }
    cfg.role = 'admin';
    if (core.el('admin-pin')) core.el('admin-pin').value = '';
    core.applyRoleUI();
    core.showToast('Admin režim odemcen', 'success');
  });

  core.el('admin-lock-btn')?.addEventListener('click', () => {
    cfg.role = 'operator';
    core.applyRoleUI();
    core.showToast('Operator režim aktivní', 'success');
  });

  window.addEventListener('online', core.updateOfflineBanner);
  window.addEventListener('offline', core.updateOfflineBanner);
  core.updateOfflineBanner();

  await core.loadAll();
  core.applyRoleUI();
  core.setupBackgroundSync();

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(e => console.warn('[SW]', e));
  }

  const p = new URLSearchParams(location.search);
  if (p.get('mode')) core.setMode(p.get('mode'));
  if (p.get('screen')) core.navigate(p.get('screen'));
  core.applyRoleUI();
}

document.addEventListener('DOMContentLoaded', init);