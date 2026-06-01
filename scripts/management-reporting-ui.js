'use strict';

(() => {
  const Api = window.PrintGuardManagementReportingApi;
  const Auth = window.PrintGuardAuth;
  const AppConfig = window.PrintGuardAppConfig;

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function num(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }

  function fmt(value, digits = 0, suffix = '') {
    if (value == null || value === '') return '—';
    return `${num(value).toLocaleString('cs-CZ', {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    })}${suffix}`;
  }

  function todayInputValue() {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/Prague',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(new Date());
    const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return `${map.year}-${map.month}-${map.day}`;
  }

  function previousMonthValue() {
    const date = new Date(`${todayInputValue()}T00:00:00`);
    date.setMonth(date.getMonth() - 1);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
  }

  function toast(message, type) {
    if (window.PrintGuardDomUtils && typeof window.PrintGuardDomUtils.showToast === 'function') {
      window.PrintGuardDomUtils.showToast(message, type);
      return;
    }
    console[type === 'error' ? 'error' : 'log'](message);
  }

  function headers() {
    return Auth && typeof Auth.postPurchaseHeaders === 'function' ? Auth.postPurchaseHeaders() : {};
  }

  function fetchImpl() {
    return Auth && typeof Auth.appFetch === 'function' ? Auth.appFetch : fetch;
  }

  function metric(label, value, hint) {
    return `<div class="metric-block">
      <span class="metric-big">${esc(value)}</span>
      <span class="metric-unit">${esc(label)}</span>
      ${hint ? `<span class="metric-desc">${esc(hint)}</span>` : ''}
    </div>`;
  }

  function renderWarnings(host, warnings) {
    host.innerHTML = (warnings || []).length
      ? `<div class="reporting-warnings">${warnings.map((warning) => `<p>${esc(warning)}</p>`).join('')}</div>`
      : '';
  }

  function renderRows(rows, columns) {
    if (!rows || !rows.length) {
      return '<div class="empty-state"><p>Žádná data pro vybrané období.</p></div>';
    }
    return `<table class="data-table reporting-table">
      <thead><tr>${columns.map((col) => `<th>${esc(col.label)}</th>`).join('')}</tr></thead>
      <tbody>${rows.map((row) => `<tr>${columns.map((col) => `<td>${esc(col.value(row))}</td>`).join('')}</tr>`).join('')}</tbody>
    </table>`;
  }

  function renderTrend(rows) {
    if (!rows || !rows.length) return '';
    const max = Math.max(...rows.map((row) => num(row.totalConsumedMediaM2)), 1);
    return `<div class="reporting-trend">
      ${rows.map((row) => {
        const height = Math.max(8, Math.round((num(row.totalConsumedMediaM2) / max) * 96));
        return `<div class="reporting-trend-item" title="${esc(row.month)}">
          <div class="reporting-trend-bar" style="height:${height}px"></div>
          <span>${esc(row.month.slice(5))}</span>
        </div>`;
      }).join('')}
    </div>`;
  }

  function renderMonthly(report) {
    const metrics = report.metrics || {};
    document.getElementById('reporting-monthly-period').textContent = `Měsíc ${report.month}`;
    document.getElementById('reporting-monthly-kpis').innerHTML = [
      metric('Media stock m2 EOM', fmt(metrics.media_stock_m2_end_of_month, 3, ' m²'), report.stock?.source || ''),
      metric('Ink stock L EOM', fmt(metrics.ink_stock_l_end_of_month, 3, ' L')),
      metric('Avg media / sales order', fmt(metrics.avg_media_m2_per_sales_order, 4, ' m²')),
      metric('Avg ink / sales order', fmt(metrics.avg_ink_l_per_sales_order, 5, ' L')),
      metric('Reprint files / standard file', fmt(metrics.reprinted_files_per_standard_file, 4)),
      metric('Avg files / sales order', fmt(metrics.avg_files_per_sales_order, 3)),
      metric('Avg files / XML', fmt(metrics.avg_files_per_xml, 3)),
      metric('Total files', fmt(metrics.total_files, 0), `${metrics.standard_file_count || 0} standard / ${metrics.reprinted_file_count || 0} reprint`),
    ].join('');
    renderWarnings(document.getElementById('reporting-monthly-warnings'), report.warnings);
    document.getElementById('reporting-monthly-trend').innerHTML = renderTrend(report.trend);
    document.getElementById('reporting-monthly-printer-table').innerHTML = renderRows(report.consumptionByPrinter, [
      { label: 'Printer', value: (row) => row.printer },
      { label: 'Jobs', value: (row) => fmt(row.doneJobs) },
      { label: 'Media m²', value: (row) => fmt(row.consumedMediaM2, 3) },
      { label: 'Ink L', value: (row) => fmt(row.consumedInkL, 4) },
      { label: 'Nett h', value: (row) => fmt(row.nettPrintingTimeHours, 3) },
    ]);
    document.getElementById('reporting-monthly-stock-table').innerHTML = renderRows((report.stock && report.stock.rows) || [], [
      { label: 'Item', value: (row) => row.itemName || row.articleNumber },
      { label: 'Type', value: (row) => row.stockType || row.category || '' },
      { label: 'On hand', value: (row) => `${fmt(row.onHand, 3)} ${row.unit || ''}` },
      { label: 'Media m²', value: (row) => fmt(row.mediaStockM2, 3) },
      { label: 'Ink L', value: (row) => fmt(row.inkStockL, 3) },
    ]);
  }

  function renderEod(report) {
    document.getElementById('reporting-eod-period').textContent =
      `Report ${report.report_date} · incoming ${report.incoming_period_start} až ${report.incoming_period_end}`;
    document.getElementById('reporting-eod-kpis').innerHTML = [
      metric('API received orders', fmt(report.api_received_sales_orders)),
      metric('Processed XML', fmt(report.processed_xml_count)),
      metric('Processed orders / API incoming / missing', `${fmt(report.processed_sales_order_count)} / ${fmt(report.expected_count)} / ${fmt(report.missing_count)}`),
      metric('Nett printing hours', fmt(report.nett_printing_time_hours, 3, ' h')),
      metric('Consumed media', fmt(report.consumed_media_m2, 3, ' m²')),
      metric('Consumed ink', fmt(report.consumed_ink_l, 4, ' L')),
      metric('Avg files / sales order', fmt(report.avg_files_per_sales_order, 3)),
      metric('Standard / reprint files', `${fmt(report.standard_file_count)} / ${fmt(report.reprint_file_count)}`),
    ].join('');
    renderWarnings(document.getElementById('reporting-eod-warnings'), report.warnings);
    document.getElementById('reporting-eod-printer-table').innerHTML = renderRows(report.production?.nettPrintingTimeByPrinter || [], [
      { label: 'Printer', value: (row) => row.printer },
      { label: 'Jobs', value: (row) => fmt(row.doneJobs) },
      { label: 'Nett h', value: (row) => fmt(row.nettPrintingTimeHours, 3) },
      { label: 'Gross h', value: (row) => fmt(row.grossElapsedTimeHours, 3) },
      { label: 'Media m²', value: (row) => fmt(row.consumedMediaM2, 3) },
      { label: 'Ink L', value: (row) => fmt(row.consumedInkL, 4) },
    ]);
    document.getElementById('reporting-eod-status-table').innerHTML = renderRows(report.statusBreakdown || [], [
      { label: 'Status', value: (row) => row.status },
      { label: 'Count', value: (row) => fmt(row.count) },
    ]);
  }

  async function loadMonthly() {
    const input = document.getElementById('reporting-month-input');
    const button = document.getElementById('reporting-month-load');
    if (button) button.disabled = true;
    try {
      const report = await Api.loadMonthlyReport({
        fetchImpl: fetchImpl(),
        headers: headers(),
        month: input?.value || previousMonthValue(),
      });
      renderMonthly(report);
    } catch (error) {
      console.error('Monthly management report failed', error);
      toast(error.message || 'Monthly report failed', 'error');
    } finally {
      if (button) button.disabled = false;
    }
  }

  async function loadEod() {
    const input = document.getElementById('reporting-eod-date');
    const button = document.getElementById('reporting-eod-load');
    if (button) button.disabled = true;
    try {
      const report = await Api.loadEodReport({
        fetchImpl: fetchImpl(),
        headers: headers(),
        date: input?.value || todayInputValue(),
      });
      renderEod(report);
    } catch (error) {
      console.error('EOD management report failed', error);
      toast(error.message || 'EOD report failed', 'error');
    } finally {
      if (button) button.disabled = false;
    }
  }

  function initManagementReportingUI() {
    if (!Api) return;
    const monthInput = document.getElementById('reporting-month-input');
    const eodInput = document.getElementById('reporting-eod-date');
    if (monthInput && !monthInput.value) monthInput.value = previousMonthValue();
    if (eodInput && !eodInput.value) eodInput.value = todayInputValue();
    document.getElementById('reporting-unlock')?.addEventListener('click', () => {
      const input = document.getElementById('reporting-pin');
      const pin = (input?.value || '').trim();
      if (!pin) {
        toast('Zadej PIN operátora.', 'error');
        return;
      }
      if (AppConfig && AppConfig.cfg) AppConfig.cfg.postPurchasePin = pin;
      if (input) input.value = '';
      toast('Reporting odemčen.', 'success');
      loadedOnce = false;
      loadManagementReporting();
    });
    document.getElementById('reporting-month-load')?.addEventListener('click', loadMonthly);
    document.getElementById('reporting-eod-load')?.addEventListener('click', loadEod);
  }

  let loadedOnce = false;
  function loadManagementReporting() {
    if (!loadedOnce) {
      loadedOnce = true;
      loadMonthly();
      loadEod();
    }
  }

  window.PrintGuardManagementReportingUI = {
    initManagementReportingUI,
    loadEod,
    loadManagementReporting,
    loadMonthly,
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initManagementReportingUI);
  } else {
    initManagementReportingUI();
  }
})();
