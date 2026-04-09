(function attachPrintGuardPrintLogUI(global) {
  'use strict';

  function printLogRangeLabel(S, i18n) {
    if (S.printLogDateFrom || S.printLogDateTo) {
      return `${S.printLogDateFrom || '…'} → ${S.printLogDateTo || '…'}`;
    }
    return i18n('print.range.full');
  }

  function printResultClass(result) {
    const norm = String(result || '').toLowerCase();
    if (norm === 'done') return 'done';
    if (norm === 'abrt' || norm === 'aborted') return 'abrt';
    if (norm === 'deleted') return 'deleted';
    return '';
  }

  function printResultLabel(result, i18n) {
    const norm = String(result || '').trim().toLowerCase();
    if (norm === 'done') return i18n('print.result.done');
    if (norm === 'abrt' || norm === 'aborted') return i18n('print.result.abrt');
    if (norm === 'deleted') return i18n('print.result.deleted');
    return result || '—';
  }

  function getPrintLogTodayQueueBasisLabel(basis) {
    if (basis === 'reception_at_fallback_ready_at') return 'reception_at, fallback ready_at';
    if (basis === 'ready_at') return 'ready_at';
    return 'arrival';
  }

  function renderPrintLogSummary(deps) {
    const {
      S,
      elSet,
      fmtDuration,
      fmtInt,
      fmtMeasure,
      fmtN,
      formatPrintLogInkBreakdown,
      getPrintLogInkChannels,
      getPrintLogLifecycleMetrics,
      getPrintLogSummaryInk,
      hasPrintLogInkBreakdown,
      printLogRangeLabel,
    } = deps;

    const summary = S.printLogSummary || {};
    const lifecycle = getPrintLogLifecycleMetrics();
    const displayInk = getPrintLogSummaryInk(summary);
    const summaryChannels = getPrintLogInkChannels(summary);
    const summaryBreakdown = summary?.inkDataAvailable && hasPrintLogInkBreakdown(summaryChannels)
      ? formatPrintLogInkBreakdown(summaryChannels)
      : '';

    elSet('pl-done-jobs', fmtInt(summary.doneJobs));
    elSet('pl-aborted-jobs', fmtInt(summary.abortedJobs));
    elSet('pl-deleted-jobs', fmtInt(summary.deletedJobs));
    elSet('pl-printed-area', fmtMeasure(summary.printedAreaM2, 'm²', 2));
    elSet('pl-media-length', fmtMeasure(summary.mediaLengthM, 'm', 2));
    elSet('pl-est-ink', displayInk.inkL === null ? '—' : fmtMeasure(displayInk.inkL, 'L', 3));
    elSet('pl-duration', fmtDuration(summary.totalDurationSec));
    elSet('pl-sla-total', fmtInt(lifecycle.totalGroups));
    elSet('pl-sla-first-pass', fmtInt(lifecycle.firstPassCount));
    elSet('pl-sla-first-rate', `${fmtN(lifecycle.firstPassRate, 1)} %`);
    elSet('pl-sla-resolved', fmtInt(lifecycle.resolvedAfterRetryCount));
    elSet('pl-sla-open', fmtInt(lifecycle.unresolvedCount));
    elSet('pl-sla-attempts', fmtN(lifecycle.avgAttempts, 2));
    elSet('pl-sla-attempts-success', fmtN(lifecycle.avgAttemptsSuccess, 2));
    elSet('pl-compare-range', printLogRangeLabel());
    elSet('pl-cmyk-note', summaryBreakdown ? `CMYK · ${summaryBreakdown}` : '');
  }

  function renderPrintLogComparison(deps) {
    const {
      S,
      el,
      esc,
      fmtInt,
      fmtMeasure,
      formatPrintLogInkBreakdown,
      getNullableNumber,
      getPrintLogInkChannels,
      getPrintLogMachineId,
      getPrintLogPeriodInkRatio,
      i18n,
      mapPrinterName,
    } = deps;

    const compare = S.printLogSummary?.byPrinter || {};
    const canUseDirectInk = Boolean(S.printLogSummary?.inkDataAvailable);
    const printers = Object.keys(compare);
    const grid = el('pl-compare-grid');
    if (!grid) return;

    grid.innerHTML = printers.map(name => {
      const rec = compare[name] || {};
      const displayName = mapPrinterName(name);
      const machineId = getPrintLogMachineId(name);
      const ratio = machineId ? getPrintLogPeriodInkRatio(machineId) : null;
      const directInk = canUseDirectInk ? getNullableNumber(rec.inkTotalL) : null;
      const breakdown = formatPrintLogInkBreakdown(getPrintLogInkChannels(rec));
      const displayInk = directInk !== null
        ? directInk
        : (ratio !== null && Number(rec.printedAreaM2) > 0 ? rec.printedAreaM2 * ratio : null);

      return `<div class="metric-block">
      <span class="metric-big">${fmtInt(rec.doneJobs || 0)}</span>
      <span class="metric-unit">${esc(displayName)}</span>
      <span class="metric-desc">${i18n('print.result.done')} · ${fmtMeasure(rec.printedAreaM2 || 0, 'm²', 2)} · ${fmtMeasure(rec.mediaLengthM || 0, 'm', 2)}${displayInk === null ? '' : ` · ${fmtMeasure(displayInk, 'L', 3)}`}</span>
      ${directInk !== null && breakdown ? `<span class="metric-desc">${esc(breakdown)}</span>` : ''}
    </div>`;
    }).join('');
  }

  function renderPrintLogTodayQueue(deps) {
    const {
      S,
      ds,
      el,
      esc,
      fmtInt,
      getPrintLogTodayQueueBasisLabel,
      mapPrinterName,
    } = deps;

    const grid = el('pl-today-queue-grid');
    const note = el('pl-today-queue-note');
    const badge = el('pl-today-queue-badge');
    if (!grid) return;

    const today = ds();
    if (badge) badge.textContent = `příjem ${today}`;
    const queue = S.printLogTodayQueue;
    const selectedPrinters = S.printLogPrinter === 'all'
      ? ['Colorado-91', 'Colorado-92']
      : [S.printLogPrinter];

    if (!queue) {
      grid.innerHTML = `<div class="metric-block"><span class="metric-big">—</span><span class="metric-unit">Dnešní fronta</span><span class="metric-desc">Data se nepodařilo načíst</span></div>`;
      if (note) note.textContent = `Datum ${today}`;
      return;
    }

    const days = Array.isArray(queue.days) ? queue.days : [];
    const byPrinter = new Map(days.map(row => [row.printerName, row]));
    const totals = queue.totals || {};
    const totalJobs = Number(totals.totalJobs || 0);
    const uniqueJobs = Number(totals.uniqueJobs || 0);

    const cards = [
      `<div class="metric-block">
      <span class="metric-big">${fmtInt(totalJobs)}</span>
      <span class="metric-unit">Celkem dnes</span>
      <span class="metric-desc">Unikátní úlohy ${fmtInt(uniqueJobs)} · Hotovo ${fmtInt(totals.doneJobs || 0)} · Abrt ${fmtInt(totals.abortedJobs || 0)} · Deleted ${fmtInt(totals.deletedJobs || 0)}</span>
    </div>`
    ];

    selectedPrinters.forEach(printerName => {
      const row = byPrinter.get(printerName);
      cards.push(`<div class="metric-block">
      <span class="metric-big">${fmtInt(row?.totalJobs || 0)}</span>
      <span class="metric-unit">${esc(mapPrinterName(printerName))}</span>
      <span class="metric-desc">Hotovo ${fmtInt(row?.doneJobs || 0)} · Abrt ${fmtInt(row?.abortedJobs || 0)} · Deleted ${fmtInt(row?.deletedJobs || 0)}</span>
    </div>`);
    });

    grid.innerHTML = cards.join('');
    if (note) {
      note.textContent = `Datum ${today} · Basis ${getPrintLogTodayQueueBasisLabel(queue.basis)}${totalJobs === 0 ? ' · V DB dnes nejsou žádné přijaté tiskové úlohy' : ''}`;
    }
  }

  global.PrintGuardPrintLogUI = {
    getPrintLogTodayQueueBasisLabel,
    printLogRangeLabel,
    printResultClass,
    printResultLabel,
    renderPrintLogComparison,
    renderPrintLogSummary,
    renderPrintLogTodayQueue,
  };
})(window);
