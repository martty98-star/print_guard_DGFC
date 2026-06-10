/* PrintGuard — print log orchestration (loaded before app.js) */
'use strict';

(function attachPrintGuardPrintLog(global) {
  function createPrintLog(deps) {
    const {
      Reports,
      S,
      computeCoIntervals,
      ds,
      el,
      elSet,
      esc,
      fmtDT,
      fmtDuration,
      fmtDurationSeconds,
      fmtInt,
      fmtMeasure,
      fmtN,
      getNullableNumber,
      i18n,
      printLogRangeLabelUI,
      printResultClassUI,
      printResultLabelUI,
      getPrintLogTodayQueueBasisLabelUI,
      renderPrintLogComparisonUI,
      renderPrintLogSummaryUI,
      renderPrintLogTodayQueueUI,
      showToast,
    } = deps;
    let controlsBound = false;

    function printLogRangeLabel() {
      return printLogRangeLabelUI(S, i18n);
    }

    function printResultClass(result) {
      return printResultClassUI(result);
    }

    function printResultLabel(result) {
      return printResultLabelUI(result, i18n);
    }

    function getPrintLogTodayQueueBasisLabel(basis) {
      return getPrintLogTodayQueueBasisLabelUI(basis);
    }

    function renderPrintLogSummary() {
      return renderPrintLogSummaryUI({
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
      });
    }

    function renderPrintLogComparison() {
      return renderPrintLogComparisonUI({
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
      });
    }

    function renderPrintLogTodayQueue() {
      return renderPrintLogTodayQueueUI({
        S,
        ds,
        el,
        esc,
        fmtInt,
        getPrintLogTodayQueueBasisLabel,
        mapPrinterName,
      });
    }

    // ══════════════════════════════════════════════════════════
    //  PRINT LOG MODULE
    // ══════════════════════════════════════════════════════════

    const PRINT_LOG_PAGE_SIZE = 50;
    const PRINT_LOG_LIFECYCLE_GAP_MS = 2 * 60 * 60 * 1000;

    function mapPrinterName(name) {
      if (!name) return '—';
      if (name.includes('91')) return 'Colorado A';
      if (name.includes('92')) return 'Colorado B';
      return name;
    }

    function getPrintLogParams(overrides = {}) {
      const params = new URLSearchParams();
      if (S.printLogDateFrom) params.set('from', S.printLogDateFrom);
      if (S.printLogDateTo) params.set('to', S.printLogDateTo);
      if (S.printLogPrinter !== 'all') params.set('printer', S.printLogPrinter);
      if (S.printLogResult !== 'all') params.set('result', S.printLogResult);
      params.set('limit', String(overrides.limit ?? PRINT_LOG_PAGE_SIZE));
      params.set('offset', String(overrides.offset ?? S.printLogOffset));
      return params;
    }

    async function fetchPrintLogSummary() {
      const res = await fetch(
        '/.netlify/functions/print-log-summary?' +
          getPrintLogParams().toString(),
        { cache: 'no-store' },
      );
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j.ok)
        throw new Error(j.error || 'Print log summary failed');
      return j;
    }

    async function fetchPrintLogRows(overrides = {}) {
      const res = await fetch(
        '/.netlify/functions/print-log-rows?' +
          getPrintLogParams(overrides).toString(),
        { cache: 'no-store' },
      );
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j.ok) throw new Error(j.error || 'Print log rows failed');
      return j;
    }

    function getPrintLogTodayQueueParams() {
      const params = new URLSearchParams();
      const today = ds();
      params.set('from', today);
      params.set('to', today);
      if (S.printLogPrinter !== 'all') params.set('printer', S.printLogPrinter);
      if (S.printLogResult !== 'all') params.set('result', S.printLogResult);
      return params;
    }

    async function fetchPrintLogTodayQueue() {
      const res = await fetch(
        '/.netlify/functions/print-log-arrivals?' +
          getPrintLogTodayQueueParams().toString(),
        { cache: 'no-store' },
      );
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j.ok)
        throw new Error(j.error || 'Print log arrivals failed');
      return j;
    }

    function normalizePrintLogRow(row) {
      const sourceFile = row?.sourceFile ?? row?.source_file ?? '';
      return {
        ...row,
        sourceFile: sourceFile || '',
        source_file: sourceFile || '',
      };
    }

    function printLogJobLabel(row) {
      const parts = [];
      if (row?.jobName) parts.push(row.jobName);
      return parts.join(' · ') || '—';
    }

    function getPrintLogMachineId(printerName) {
      const name = String(printerName || '');
      if (name.includes('91')) return 'colorado1';
      if (name.includes('92')) return 'colorado2';
      return null;
    }

    function getPrintLogEstimateInterval(row) {
      const machineId = getPrintLogMachineId(row?.printerName);
      const readyMs = new Date(row?.readyAt).getTime();
      if (!machineId || !Number.isFinite(readyMs)) return null;
      return (
        computeCoIntervals(machineId).find((iv) => {
          const fromMs = new Date(iv.from).getTime();
          const toMs = new Date(iv.to).getTime();
          return (
            Number.isFinite(fromMs) &&
            Number.isFinite(toMs) &&
            readyMs > fromMs &&
            readyMs <= toMs
          );
        }) || null
      );
    }

    function getPrintLogInkEstimate(row) {
      const interval = getPrintLogEstimateInterval(row);
      const areaM2 = Number(row?.printedAreaM2);
      if (
        !interval ||
        !Number.isFinite(areaM2) ||
        areaM2 <= 0 ||
        interval.inkPerM2 === null
      ) {
        return {
          estimatedInkL: null,
          estimatedInkPerM2: interval?.inkPerM2 ?? null,
        };
      }
      return {
        estimatedInkL: areaM2 * interval.inkPerM2,
        estimatedInkPerM2: interval.inkPerM2,
      };
    }

    function getPrintLogPeriodInkRatio(machineId) {
      const fromMs = S.printLogDateFrom
        ? new Date(`${S.printLogDateFrom}T00:00:00`).getTime()
        : null;
      const toMs = S.printLogDateTo
        ? new Date(`${S.printLogDateTo}T23:59:59.999`).getTime()
        : null;
      const intervals = computeCoIntervals(machineId).filter((iv) => {
        const from = new Date(iv.from).getTime();
        const to = new Date(iv.to).getTime();
        if (!Number.isFinite(from) || !Number.isFinite(to)) return false;
        if (fromMs !== null && to < fromMs) return false;
        if (toMs !== null && from > toMs) return false;
        return true;
      });
      const inkUsed = intervals.reduce(
        (sum, iv) => sum + (Number(iv.inkUsed) || 0),
        0,
      );
      const mediaUsed = intervals.reduce(
        (sum, iv) => sum + (Number(iv.mediaUsed) || 0),
        0,
      );
      return mediaUsed > 0 ? inkUsed / mediaUsed : null;
    }

    function getPrintLogSummaryEstimatedInk(summary) {
      const byPrinter = summary?.byPrinter || {};
      let total = 0;
      let hasEstimate = false;
      Object.entries(byPrinter).forEach(([printerName, rec]) => {
        const machineId = getPrintLogMachineId(printerName);
        if (!machineId) return;
        const ratio = getPrintLogPeriodInkRatio(machineId);
        const areaM2 = Number(rec?.printedAreaM2);
        if (!Number.isFinite(areaM2) || areaM2 <= 0 || ratio === null) return;
        total += areaM2 * ratio;
        hasEstimate = true;
      });
      return hasEstimate ? total : null;
    }

    function getPrintLogDirectInk(row) {
      const channels = getPrintLogInkChannels(row);
      const total = getNullableNumber(row?.inkTotalL);
      if (total !== null) return { inkL: total, source: 'direct', channels };

      const sum = Object.values(channels).reduce(
        (acc, value) => acc + (value || 0),
        0,
      );
      const hasChannels = Object.values(channels).some(
        (value) => value !== null,
      );
      return {
        inkL: hasChannels ? sum : null,
        source: hasChannels ? 'direct' : null,
        channels,
      };
    }

    function getPrintLogInkChannels(row) {
      return {
        cyan: getNullableNumber(row?.inkCyanL),
        magenta: getNullableNumber(row?.inkMagentaL),
        yellow: getNullableNumber(row?.inkYellowL),
        black: getNullableNumber(row?.inkBlackL),
        white: getNullableNumber(row?.inkWhiteL),
      };
    }

    function getPrintLogInkDisplay(row) {
      const direct = getPrintLogDirectInk(row);
      if (direct.inkL !== null) return direct;
      const estimate = getPrintLogInkEstimate(row);
      return {
        inkL: estimate.estimatedInkL,
        source: estimate.estimatedInkL === null ? null : 'estimated',
        channels: null,
        estimatedInkPerM2: estimate.estimatedInkPerM2,
      };
    }

    function getPrintLogSummaryInk(summary) {
      const direct = getNullableNumber(summary?.inkTotalL);
      if (summary?.inkDataAvailable && direct !== null) {
        return { inkL: direct, source: 'direct' };
      }
      const estimated = getPrintLogSummaryEstimatedInk(summary);
      return {
        inkL: estimated,
        source: estimated === null ? null : 'estimated',
      };
    }

    const PRINT_LOG_INK_WARN_L_PER_M2 = 0.05;

    function logPrintLogInkDiagnostics() {
      const summary = S.printLogSummary || null;
      if (!summary) return;

      const displayInk = getPrintLogSummaryInk(summary);
      const totalAreaM2 = getNullableNumber(summary.printedAreaM2);
      const litersPerM2 =
        displayInk.inkL !== null && totalAreaM2 && totalAreaM2 > 0
          ? displayInk.inkL / totalAreaM2
          : null;

      const sampleRows = (S.printLogRows || [])
        .map((row) => {
          const direct = getPrintLogDirectInk(row);
          const display = getPrintLogInkDisplay(row);
          return {
            readyAt: row.readyAt || '',
            printerName: row.printerName || '',
            jobName: row.jobName || '',
            sourceFile: row.sourceFile || '',
            result: row.result || '',
            printedAreaM2: getNullableNumber(row.printedAreaM2),
            inkSource: display.source || '',
            inkCyanL: direct.channels?.cyan,
            inkMagentaL: direct.channels?.magenta,
            inkYellowL: direct.channels?.yellow,
            inkBlackL: direct.channels?.black,
            inkWhiteL: direct.channels?.white,
            finalInkL: display.inkL,
          };
        })
        .filter((row) => row.finalInkL !== null)
        .slice(0, 10);

      console.groupCollapsed('[Print Log] Ink diagnostics');
      console.log('overview', {
        source: displayInk.source || null,
        totalInkL: displayInk.inkL,
        printedAreaM2: totalAreaM2,
        litersPerM2,
        loadedRows: (S.printLogRows || []).length,
      });
      if (sampleRows.length) console.table(sampleRows);
      console.groupEnd();

      if (litersPerM2 !== null && litersPerM2 > PRINT_LOG_INK_WARN_L_PER_M2) {
        console.warn('[Print Log] Suspicious ink intensity detected', {
          litersPerM2,
          threshold: PRINT_LOG_INK_WARN_L_PER_M2,
          totalInkL: displayInk.inkL,
          printedAreaM2: totalAreaM2,
          source: displayInk.source || null,
        });
      }
    }

    function formatPrintLogInkBreakdown(channels) {
      if (!channels) return '';
      const parts = [];
      if (channels.cyan !== null) parts.push(`C ${fmtN(channels.cyan, 3)}`);
      if (channels.magenta !== null)
        parts.push(`M ${fmtN(channels.magenta, 3)}`);
      if (channels.yellow !== null) parts.push(`Y ${fmtN(channels.yellow, 3)}`);
      if (channels.black !== null) parts.push(`K ${fmtN(channels.black, 3)}`);
      if (channels.white !== null && channels.white > 0)
        parts.push(`W ${fmtN(channels.white, 3)}`);
      return parts.join(' · ');
    }

    function hasPrintLogInkBreakdown(channels) {
      if (!channels) return false;
      return Object.values(channels).some(
        (value) => value !== null && value > 0,
      );
    }

    function normalizePrintLogText(v) {
      return String(v || '')
        .trim()
        .toLowerCase()
        .replace(/\.[a-z0-9]{1,6}$/i, '')
        .replace(/[_-]+/g, ' ')
        .replace(/\s+/g, ' ');
    }

    function normalizePrintLogSourceFile(v) {
      const raw = String(v || '').trim();
      if (!raw) return '';
      const last = raw.split(/[\\/]/).pop() || raw;
      return normalizePrintLogText(last);
    }

    function normalizePrintLogResult(result) {
      const norm = String(result || '')
        .trim()
        .toLowerCase();
      if (norm === 'done') return 'done';
      if (norm === 'deleted') return 'deleted';
      if (norm === 'abrt' || norm === 'aborted') return 'abrt';
      return norm || 'unknown';
    }

    function lifecycleFilterLabel(filter) {
      return (
        {
          all: i18n('print.lifecycle.all'),
          open_issue: i18n('print.lifecycle.open'),
          resolved_after_retry: i18n('print.lifecycle.resolved'),
          multiple_attempts: i18n('print.lifecycle.multi'),
          first_pass: i18n('print.lifecycle.first'),
        }[filter] || i18n('print.lifecycle.all')
      );
    }

    function derivePrintLifecycleStatus(attempts) {
      const results = attempts.map((a) => normalizePrintLogResult(a.result));
      const doneIdx = results.reduce(
        (acc, result, idx) => (result === 'done' ? idx : acc),
        -1,
      );
      const hasDone = doneIdx >= 0;
      const failBeforeDone =
        hasDone &&
        results.slice(0, doneIdx).some((r) => r === 'deleted' || r === 'abrt');
      const doneCount = results.filter((r) => r === 'done').length;
      const deletedCount = results.filter((r) => r === 'deleted').length;
      const abrtCount = results.filter((r) => r === 'abrt').length;

      if (hasDone && failBeforeDone) {
        if (attempts.length >= 3) return 'resolved_after_retry';
        return 'resolved_after_retry';
      }
      if (hasDone && doneCount === 1 && attempts.length === 1)
        return 'success_first_try';
      if (
        hasDone &&
        doneCount > 1 &&
        !results.some((r) => r === 'deleted' || r === 'abrt')
      )
        return 'multiple_attempts_success';
      if (hasDone && doneCount >= 1 && attempts.length > 1 && !failBeforeDone)
        return 'multiple_attempts_success';
      if (!hasDone && deletedCount === attempts.length && attempts.length)
        return 'deleted_only';
      if (!hasDone && abrtCount === attempts.length && attempts.length)
        return 'aborted_only';
      if (!hasDone && (deletedCount > 0 || abrtCount > 0)) return 'open_issue';
      return 'unresolved';
    }

    function printLifecycleExplanation(group) {
      const attempts = group.attemptCount || 0;
      switch (group.lifecycleStatus) {
        case 'success_first_try':
          return i18n('print.lifecycle.expl.success_first_try');
        case 'resolved_after_retry':
          return attempts > 2
            ? `${attempts} ${i18n('print.lifecycle.attempts.before-success')}`
            : i18n('print.lifecycle.expl.resolved_after_retry');
        case 'open_issue':
          return i18n('print.lifecycle.expl.open_issue');
        case 'deleted_only':
          return i18n('print.lifecycle.expl.deleted_only');
        case 'aborted_only':
          return i18n('print.lifecycle.expl.aborted_only');
        case 'multiple_attempts_success':
          return `${attempts} ${i18n('print.lifecycle.expl.multiple_attempts_success')}`;
        default:
          return i18n('print.lifecycle.expl.unresolved');
      }
    }

    function printLifecycleBadgeLabel(status) {
      return (
        {
          success_first_try: i18n('print.lifecycle.badge.success_first_try'),
          resolved_after_retry: i18n(
            'print.lifecycle.badge.resolved_after_retry',
          ),
          open_issue: i18n('print.lifecycle.badge.open_issue'),
          deleted_only: i18n('print.lifecycle.badge.deleted_only'),
          aborted_only: i18n('print.lifecycle.badge.aborted_only'),
          multiple_attempts_success: i18n(
            'print.lifecycle.badge.multiple_attempts_success',
          ),
          unresolved: i18n('print.lifecycle.badge.unresolved'),
        }[status] || status
      );
    }

    function printLifecycleFinalResult(group) {
      const latest = group.attempts[group.attempts.length - 1];
      const norm = normalizePrintLogResult(latest?.result);
      if (norm === 'done') return i18n('print.result.done');
      if (norm === 'deleted') return i18n('print.result.deleted');
      if (norm === 'abrt') return i18n('print.result.abrt');
      return latest?.result || '—';
    }

    function buildPrintLifecycleGroups(rows) {
      return Reports.printLog
        .buildPrintLifecycleGroups(rows, {
          gapMs: PRINT_LOG_LIFECYCLE_GAP_MS,
        })
        .map((group) => ({
          ...group,
          finalResult: printResultLabel(group.finalResultCode),
          explanation: printLifecycleExplanation(group),
        }));
    }

    function getPrintLogLifecycleGroups() {
      return buildPrintLifecycleGroups(S.printLogRows || []);
    }

    function getFilteredLifecycleGroups() {
      const groups = getPrintLogLifecycleGroups();
      if (S.printLogGroupFilter === 'all') return groups;
      if (S.printLogGroupFilter === 'open_issue')
        return groups.filter((g) =>
          ['open_issue', 'deleted_only', 'aborted_only', 'unresolved'].includes(
            g.lifecycleStatus,
          ),
        );
      if (S.printLogGroupFilter === 'resolved_after_retry')
        return groups.filter(
          (g) => g.lifecycleStatus === 'resolved_after_retry',
        );
      if (S.printLogGroupFilter === 'multiple_attempts')
        return groups.filter(
          (g) =>
            g.attemptCount > 1 ||
            g.lifecycleStatus === 'multiple_attempts_success',
        );
      if (S.printLogGroupFilter === 'first_pass')
        return groups.filter((g) => g.lifecycleStatus === 'success_first_try');
      return groups;
    }

    function getPrintLogLifecycleMetrics() {
      return Reports.printLog.buildPrintErrorSummary(
        getPrintLogLifecycleGroups(),
      );
    }

    async function loadPrintLog(force = false) {
      if (S.printLogLoading) return;
      if (S.printLogLoaded && !force && !S.printLogHasMore) return;

      if (force) {
        S.printLogRows = [];
        S.printLogOffset = 0;
        S.printLogHasMore = true;
        S.printLogExpandedGroups = {};
      }

      S.printLogLoading = true;
      elSet('print-log-status', i18n('print.status.loading'));
      const wrap = el('print-log-table-wrap');
      if (wrap && !S.printLogRows.length) {
        wrap.innerHTML = `<div class="loading-state"><div class="spinner"></div><p>${i18n('loading.print-log')}</p></div>`;
      }

      try {
        const [summaryRes, rowsRes, todayQueueRes] = await Promise.allSettled([
          fetchPrintLogSummary(),
          fetchPrintLogRows(),
          fetchPrintLogTodayQueue(),
        ]);

        if (summaryRes.status !== 'fulfilled') throw summaryRes.reason;
        if (rowsRes.status !== 'fulfilled') throw rowsRes.reason;

        const summary = summaryRes.value;
        const rows = rowsRes.value;
        S.printLogSummary = summary.summary || null;
        S.printLogTodayQueue =
          todayQueueRes.status === 'fulfilled'
            ? todayQueueRes.value || null
            : null;
        const newRows = Array.isArray(rows.rows)
          ? rows.rows.map(normalizePrintLogRow)
          : [];
        S.printLogRows = [...S.printLogRows, ...newRows];
        S.printLogOffset += newRows.length;
        S.printLogHasMore = Boolean(rows.hasMore);
        S.printLogLoaded = true;
        renderPrintLog();
        logPrintLogInkDiagnostics();
        const statusTxt = summary.generatedAt
          ? `${i18n('print.status.updated')} ${fmtDT(summary.generatedAt)}`
          : i18n('print.status.default');
        elSet('print-log-status', statusTxt);
      } catch (err) {
        if (wrap) {
          wrap.innerHTML = `<div class="empty-state"><div class="empty-state-icon">⚠</div><p>${i18n('print.error.load')}</p><div class="table-empty-note">${esc(err.message || err)}</div></div>`;
        }
        elSet('print-log-status', i18n('print.status.error'));
        showToast(i18n('print.toast.prefix') + (err.message || err), 'error');
      } finally {
        S.printLogLoading = false;
      }
    }

    function renderPrintLog() {
      renderPrintLogSummary();
      renderPrintLogComparison();
      renderPrintLogTodayQueue();
      renderPrintLogRows();
    }

    function renderPrintLogRows() {
      const wrap = el('print-log-table-wrap');
      const foot = el('print-log-footnote');
      if (!wrap) return;
      if (S.printLogViewMode === 'grouped')
        return renderPrintLifecycleGroups(wrap, foot);
      if (!S.printLogRows.length) {
        wrap.innerHTML = `<div class="empty-state"><div class="empty-state-icon">📋</div><p>${i18n('print.empty.jobs')}</p></div>`;
        if (foot)
          foot.textContent = `${i18n('print.foot.total.prefix')} 0 ${i18n('print.foot.total.suffix')}`;
        return;
      }

      const thReady = i18n('table.ready');
      const thMachine = i18n('table.machine');
      const thJob = i18n('table.job');
      const thResult = i18n('table.result');
      const thMedia = i18n('table.media');
      const thArea = i18n('table.printed-area');
      const thInk = i18n('print.stats.ink');
      const thDuration = i18n('table.duration');
      const rows = S.printLogRows
        .map((row) => {
          const ink = getPrintLogInkDisplay(row);
          const breakdown =
            ink.source === 'direct'
              ? formatPrintLogInkBreakdown(ink.channels)
              : '';
          return `<tr>
    <td>${fmtDT(row.readyAt)}</td>
    <td>${esc(mapPrinterName(row.printerName))}</td>
    <td>${esc(printLogJobLabel(row))}</td>
    <td><span class="result-badge ${printResultClass(row.result)}">${esc(printResultLabel(row.result))}</span></td>
    <td>${esc(row.mediaType || '—')}</td>
    <td class="num">${fmtMeasure(row.printedAreaM2, 'm²', 2)}</td>
    <td class="num">${ink.inkL === null ? '—' : fmtMeasure(ink.inkL, 'L', 3)}${breakdown ? `<div style="font-size:.72rem;color:var(--text-faint);white-space:nowrap">${esc(breakdown)}</div>` : ''}</td>
    <td class="num">${fmtDurationSeconds(row.durationSec)}</td>
  </tr>`;
        })
        .join('');

      const loadMoreBtn = S.printLogHasMore
        ? `<div class="print-log-load-more-wrap"><button id="pl-load-more" class="print-log-load-more">${i18n('print.load-more')}</button></div>`
        : '';

      wrap.innerHTML = `<table class="data-table">
    <thead><tr>
      <th>${thReady}</th>
      <th>${thMachine}</th>
      <th>${thJob}</th>
      <th>${thResult}</th>
      <th>${thMedia}</th>
      <th>${thArea}</th>
      <th>${thInk}</th>
      <th>${thDuration}</th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table>
  ${loadMoreBtn}`;

      if (foot)
        foot.textContent = `${i18n('print.foot.total.prefix')} ${S.printLogRows.length} ${i18n('print.foot.total.suffix')}`;
    }

    function bindPrintLogControls(options = {}) {
      const onExportCsv = options.exportCSVPrintLog;
      if (controlsBound) return;
      controlsBound = true;

      el('print-log-from').addEventListener('change', (e) => {
        S.printLogDateFrom = e.target.value;
        loadPrintLog(true);
      });
      el('print-log-to').addEventListener('change', (e) => {
        S.printLogDateTo = e.target.value;
        loadPrintLog(true);
      });
      el('print-log-view-mode').addEventListener('change', (e) => {
        S.printLogViewMode = e.target.value || 'raw';
        const isGrouped = S.printLogViewMode === 'grouped';
        el('print-log-group-filter-wrap')?.classList.toggle(
          'hidden',
          !isGrouped,
        );
        elSet(
          'print-log-table-title',
          isGrouped ? 'Reseni problemu / SLA' : 'Posledni tiskove aktivity',
        );
        renderPrintLogRows();
      });
      el('print-log-printer').addEventListener('change', (e) => {
        S.printLogPrinter = e.target.value;
        loadPrintLog(true);
      });
      el('print-log-result').addEventListener('change', (e) => {
        S.printLogResult = e.target.value;
        loadPrintLog(true);
      });
      el('print-log-group-filter').addEventListener('change', (e) => {
        S.printLogGroupFilter = e.target.value || 'all';
        renderPrintLogRows();
      });
      el('print-log-clear-dates').addEventListener('click', () => {
        S.printLogDateFrom = '';
        S.printLogDateTo = '';
        el('print-log-from').value = '';
        el('print-log-to').value = '';
        loadPrintLog(true);
      });
      el('print-log-refresh-btn').addEventListener('click', () => {
        loadPrintLog(true);
      });
      el('print-log-export-btn').addEventListener('click', () => {
        if (typeof onExportCsv === 'function') onExportCsv();
      });
      document.addEventListener('click', (e) => {
        const groupRow = e.target?.closest?.('.pl-group-row[data-group-id]');
        if (groupRow) {
          const id = groupRow.dataset.groupId;
          S.printLogExpandedGroups[id] = !S.printLogExpandedGroups[id];
          renderPrintLogRows();
          return;
        }
        if (e.target?.id === 'pl-load-more') {
          loadPrintLog(false);
        }
      });
    }

    function renderPrintLifecycleGroups(wrap, foot) {
      const groups = getFilteredLifecycleGroups();
      if (!groups.length) {
        wrap.innerHTML = `<div class="empty-state"><div class="empty-state-icon">🧩</div><p>${i18n('print.empty.groups')}</p></div>`;
        if (foot)
          foot.textContent = lifecycleFilterLabel(S.printLogGroupFilter);
        return;
      }

      const rows = groups
        .map((group) => {
          const expanded = !!S.printLogExpandedGroups[group.id];
          const detailRows = group.attempts
            .map((attempt) => {
              const ink = getPrintLogInkDisplay(attempt);
              const breakdown =
                ink.source === 'direct'
                  ? formatPrintLogInkBreakdown(ink.channels)
                  : '';
              return `<tr>
      <td>${fmtDT(attempt.readyAt)}</td>
      <td><span class="result-badge ${printResultClass(attempt.result)}">${esc(printResultLabel(attempt.result))}</span></td>
      <td class="num">${fmtDurationSeconds(attempt.durationSec)}</td>
      <td class="num">${fmtMeasure(attempt.printedAreaM2, 'm²', 2)}</td>
      <td class="num">${ink.inkL === null ? '—' : fmtMeasure(ink.inkL, 'L', 3)}${breakdown ? `<div style="font-size:.72rem;color:var(--text-faint);white-space:nowrap">${esc(breakdown)}</div>` : ''}</td>
      <td>${esc(attempt.mediaType || '—')}</td>
    </tr>`;
            })
            .join('');
          const totalInk = group.attempts.reduce((sum, attempt) => {
            const ink = getPrintLogInkDisplay(attempt);
            return sum + (ink.inkL || 0);
          }, 0);
          return `<tbody class="pl-group-body ${expanded ? 'expanded' : ''}">
      <tr class="pl-group-row" data-group-id="${esc(group.id)}">
        <td>${fmtDT(group.latestReadyAt)}</td>
        <td>${esc(mapPrinterName(group.printerName))}</td>
        <td>${esc(printLogJobLabel(group))}<div class="pl-subline">${esc(group.explanation)}</div></td>
        <td><span class="result-badge lifecycle ${group.lifecycleStatus}">${esc(printLifecycleBadgeLabel(group.lifecycleStatus))}</span></td>
        <td class="num">${fmtInt(group.attemptCount)}</td>
        <td>${esc(group.finalResult)}</td>
        <td class="num">${fmtMeasure(group.finalPrintedAreaM2, 'm²', 2)}</td>
        <td class="num">${totalInk > 0 ? fmtMeasure(totalInk, 'L', 3) : '—'}</td>
        <td>${esc(group.mediaType || '—')}</td>
      </tr>
      <tr class="pl-group-detail-row ${expanded ? '' : 'hidden'}">
        <td colspan="9">
          <div class="pl-group-detail">
            <div class="pl-detail-head">
              <strong>${esc(group.explanation)}</strong>
              <span>${group.attemptCount} ${i18n('table.attempts').toLowerCase()} · ${fmtDuration(group.totalDurationSec)} · ${fmtMeasure(group.totalPrintedAreaM2, 'm²', 2)}</span>
            </div>
            <table class="data-table pl-detail-table">
              <thead><tr><th>${i18n('table.ready')}</th><th>${i18n('table.result')}</th><th>${i18n('table.duration')}</th><th>${i18n('table.printed-area')}</th><th>${i18n('print.stats.ink')}</th><th>${i18n('table.media')}</th></tr></thead>
              <tbody>${detailRows}</tbody>
            </table>
          </div>
        </td>
      </tr>
    </tbody>`;
        })
        .join('');

      const loadMoreBtn = S.printLogHasMore
        ? `<div class="print-log-load-more-wrap"><button id="pl-load-more" class="print-log-load-more">${i18n('print.load-more')}</button></div>`
        : '';
      wrap.innerHTML = `<table class="data-table pl-group-table">
      <thead><tr><th>${i18n('table.last-attempt')}</th><th>${i18n('table.machine')}</th><th>${i18n('table.job')}</th><th>Source file</th><th>${i18n('table.status')}</th><th>${i18n('table.attempts')}</th><th>${i18n('table.final-result')}</th><th>${i18n('table.final-area')}</th><th>${i18n('print.stats.ink')}</th><th>${i18n('table.media')}</th></tr></thead>
      ${rows}
    </table>${loadMoreBtn}`;

      if (foot)
        foot.textContent = `${groups.length} ${i18n('print.lifecycle.summary')} · ${lifecycleFilterLabel(S.printLogGroupFilter)}${S.printLogHasMore ? ' · ' + i18n('print.range.partial') : ''}`;
    }

    return {
      bindPrintLogControls,
      fetchPrintLogRows,
      getPrintLogDirectInk,
      getPrintLogEstimateInterval,
      getPrintLogInkDisplay,
      loadPrintLog,
      mapPrinterName,
      normalizePrintLogRow,
      printResultLabel,
      renderPrintLog,
      renderPrintLogRows,
    };
  }

  global.PrintGuardPrintLog = { createPrintLog };
})(window);
