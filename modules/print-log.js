export function createPrintLogModule(core) {
  const {
    S,
    el,
    elSet,
    esc,
    fmtN,
    fmtDT,
    showToast,
  } = core;

  const PRINT_LOG_PAGE_SIZE = 50;
  const PRINT_LOG_LIFECYCLE_GAP_MS = 2 * 60 * 60 * 1000;

  function mapPrinterName(name) {
    if (!name) return '—';
    if (name.includes('91')) return 'Colorado A';
    if (name.includes('92')) return 'Colorado B';
    return name;
  }

  function getPrintLogParams() {
    const params = new URLSearchParams();
    if (S.printLogDateFrom) params.set('from', S.printLogDateFrom);
    if (S.printLogDateTo) params.set('to', S.printLogDateTo);
    if (S.printLogPrinter !== 'all') params.set('printer', S.printLogPrinter);
    if (S.printLogResult !== 'all') params.set('result', S.printLogResult);
    params.set('limit', String(PRINT_LOG_PAGE_SIZE));
    params.set('offset', String(S.printLogOffset));
    return params;
  }

  async function fetchPrintLogSummary() {
    const res = await fetch('/.netlify/functions/print-log-summary?' + getPrintLogParams().toString(), { cache: 'no-store' });
    const j = await res.json().catch(() => ({}));
    if (!res.ok || !j.ok) throw new Error(j.error || 'Print log summary failed');
    return j;
  }

  async function fetchPrintLogRows() {
    const res = await fetch('/.netlify/functions/print-log-rows?' + getPrintLogParams().toString(), { cache: 'no-store' });
    const j = await res.json().catch(() => ({}));
    if (!res.ok || !j.ok) throw new Error(j.error || 'Print log rows failed');
    return j;
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
    const norm = String(result || '').trim().toLowerCase();
    if (norm === 'done') return 'done';
    if (norm === 'deleted') return 'deleted';
    if (norm === 'abrt' || norm === 'aborted') return 'abrt';
    return norm || 'unknown';
  }

  function lifecycleFilterLabel(filter) {
    return ({
      all: 'Všechny skupiny prubehu',
      open_issue: 'Pouze otevrené problémy',
      resolved_after_retry: 'Pouze vyrešené opakováním',
      multiple_attempts: 'Pouze vícenásobné pokusy',
      first_pass: 'Pouze úspech napoprvé',
    })[filter] || 'Všechny skupiny prubehu';
  }

  function derivePrintLifecycleStatus(attempts) {
    const results = attempts.map(a => normalizePrintLogResult(a.result));
    const doneIdx = results.reduce((acc, result, idx) => result === 'done' ? idx : acc, -1);
    const hasDone = doneIdx >= 0;
    const failBeforeDone = hasDone && results.slice(0, doneIdx).some(r => r === 'deleted' || r === 'abrt');
    const doneCount = results.filter(r => r === 'done').length;
    const deletedCount = results.filter(r => r === 'deleted').length;
    const abrtCount = results.filter(r => r === 'abrt').length;

    if (hasDone && failBeforeDone) return 'resolved_after_retry';
    if (hasDone && doneCount === 1 && attempts.length === 1) return 'success_first_try';
    if (hasDone && doneCount > 1 && !results.some(r => r === 'deleted' || r === 'abrt')) return 'multiple_attempts_success';
    if (hasDone && doneCount >= 1 && attempts.length > 1 && !failBeforeDone) return 'multiple_attempts_success';
    if (!hasDone && deletedCount === attempts.length && attempts.length) return 'deleted_only';
    if (!hasDone && abrtCount === attempts.length && attempts.length) return 'aborted_only';
    if (!hasDone && (deletedCount > 0 || abrtCount > 0)) return 'open_issue';
    return 'unresolved';
  }

  function printLifecycleExplanation(group) {
    const attempts = group.attemptCount || 0;
    switch (group.lifecycleStatus) {
      case 'success_first_try': return 'Dokonceno napoprvé';
      case 'resolved_after_retry': return attempts > 2 ? `${attempts} pokusu pred úspechem` : 'Vyrešeno po opakování';
      case 'open_issue': return 'Stále nevyrešeno';
      case 'deleted_only': return 'Pouze smazané pokusy';
      case 'aborted_only': return 'Pouze prerušené pokusy';
      case 'multiple_attempts_success': return `${attempts} úspešných pokusu v záznamu`;
      default: return 'Smíšený prubeh úlohy';
    }
  }

  function printLifecycleBadgeLabel(status) {
    return ({
      success_first_try: 'Napoprvé',
      resolved_after_retry: 'Vyrešeno opakováním',
      open_issue: 'Otevrený problém',
      deleted_only: 'Jen smazáno',
      aborted_only: 'Jen prerušeno',
      multiple_attempts_success: 'Více úspechu',
      unresolved: 'Nevyrešeno',
    })[status] || status;
  }

  function printLifecycleFinalResult(group) {
    const latest = group.attempts[group.attempts.length - 1];
    const norm = normalizePrintLogResult(latest?.result);
    if (norm === 'done') return 'Hotovo';
    if (norm === 'deleted') return 'Smazáno';
    if (norm === 'abrt') return 'Abrt';
    return latest?.result || '—';
  }

  function buildPrintLifecycleGroups(rows) {
    const sorted = [...rows].sort((a, b) => new Date(a.readyAt) - new Date(b.readyAt));
    const groups = [];
    const buckets = new Map();

    for (const row of sorted) {
      const jobKey = normalizePrintLogText(row.jobName);
      const sourceKey = normalizePrintLogSourceFile(row.sourceFile);
      const baseKey = [
        row.printerName || '',
        normalizePrintLogText(row.mediaType),
        sourceKey || jobKey,
        jobKey || sourceKey || 'unknown',
      ].join('||');

      const readyMs = new Date(row.readyAt).getTime();
      const bucket = buckets.get(baseKey) || [];
      let group = bucket[bucket.length - 1];
      if (!group || !Number.isFinite(readyMs) || !Number.isFinite(group.lastReadyMs) || (readyMs - group.lastReadyMs) > PRINT_LOG_LIFECYCLE_GAP_MS) {
        group = {
          id: `${baseKey}__${readyMs || Date.now()}__${groups.length}`,
          baseKey,
          attempts: [],
          firstReadyMs: readyMs,
          lastReadyMs: readyMs,
          printerName: row.printerName || '',
          mediaType: row.mediaType || '',
          sourceFile: row.sourceFile || '',
          jobName: row.jobName || '',
        };
        groups.push(group);
        bucket.push(group);
        buckets.set(baseKey, bucket);
      }

      group.attempts.push(row);
      group.lastReadyMs = readyMs;
      group.jobName = group.jobName || row.jobName || '';
      group.sourceFile = group.sourceFile || row.sourceFile || '';
    }

    return groups.map(group => {
      const attempts = group.attempts.sort((a, b) => new Date(a.readyAt) - new Date(b.readyAt));
      const latest = attempts[attempts.length - 1] || {};
      const successfulAttempts = attempts.filter(a => normalizePrintLogResult(a.result) === 'done');
      const lifecycleStatus = derivePrintLifecycleStatus(attempts);
      const finalArea = successfulAttempts.length ? successfulAttempts[successfulAttempts.length - 1].printedAreaM2 : latest.printedAreaM2;
      return {
        id: group.id,
        attempts,
        attemptCount: attempts.length,
        latestReadyAt: latest.readyAt || null,
        printerName: latest.printerName || group.printerName,
        jobName: latest.jobName || group.jobName,
        mediaType: latest.mediaType || group.mediaType,
        sourceFile: latest.sourceFile || group.sourceFile,
        lifecycleStatus,
        finalResult: printLifecycleFinalResult({ attempts }),
        finalPrintedAreaM2: finalArea == null ? null : Number(finalArea),
        totalPrintedAreaM2: attempts.reduce((sum, a) => sum + (Number(a.printedAreaM2) || 0), 0),
        mediaLengthM: attempts.reduce((sum, a) => sum + (Number(a.mediaLengthM) || 0), 0),
        totalDurationSec: attempts.reduce((sum, a) => sum + (Number(a.durationSec) || 0), 0),
        explanation: '',
        isSuccessful: normalizePrintLogResult(latest.result) === 'done',
      };
    }).map(group => ({ ...group, explanation: printLifecycleExplanation(group) }))
      .sort((a, b) => new Date(b.latestReadyAt) - new Date(a.latestReadyAt));
  }

  function getPrintLogLifecycleGroups() {
    return buildPrintLifecycleGroups(S.printLogRows || []);
  }

  function getFilteredLifecycleGroups() {
    const groups = getPrintLogLifecycleGroups();
    if (S.printLogGroupFilter === 'all') return groups;
    if (S.printLogGroupFilter === 'open_issue') return groups.filter(g => ['open_issue', 'deleted_only', 'aborted_only', 'unresolved'].includes(g.lifecycleStatus));
    if (S.printLogGroupFilter === 'resolved_after_retry') return groups.filter(g => g.lifecycleStatus === 'resolved_after_retry');
    if (S.printLogGroupFilter === 'multiple_attempts') return groups.filter(g => g.attemptCount > 1 || g.lifecycleStatus === 'multiple_attempts_success');
    if (S.printLogGroupFilter === 'first_pass') return groups.filter(g => g.lifecycleStatus === 'success_first_try');
    return groups;
  }

  function getPrintLogLifecycleMetrics() {
    const groups = getPrintLogLifecycleGroups();
    const successful = groups.filter(g => g.isSuccessful);
    const firstPass = groups.filter(g => g.lifecycleStatus === 'success_first_try');
    const resolvedRetries = groups.filter(g => g.lifecycleStatus === 'resolved_after_retry');
    const unresolved = groups.filter(g => ['open_issue', 'deleted_only', 'aborted_only', 'unresolved'].includes(g.lifecycleStatus));
    const avgAttempts = groups.length ? groups.reduce((sum, g) => sum + g.attemptCount, 0) / groups.length : 0;
    const avgAttemptsSuccess = successful.length ? successful.reduce((sum, g) => sum + g.attemptCount, 0) / successful.length : 0;
    return {
      totalGroups: groups.length,
      firstPassCount: firstPass.length,
      firstPassRate: groups.length ? (firstPass.length / groups.length) * 100 : 0,
      resolvedAfterRetryCount: resolvedRetries.length,
      unresolvedCount: unresolved.length,
      avgAttempts,
      avgAttemptsSuccess,
    };
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
    elSet('print-log-status', 'Nacítám…');
    const wrap = el('print-log-table-wrap');
    if (wrap && !S.printLogRows.length) {
      wrap.innerHTML = `<div class="loading-state"><div class="spinner"></div><p>Nacítám tiskový log…</p></div>`;
    }

    try {
      const [summary, rows] = await Promise.all([fetchPrintLogSummary(), fetchPrintLogRows()]);
      S.printLogSummary = summary.summary || null;
      const newRows = Array.isArray(rows.rows) ? rows.rows : [];
      S.printLogRows = [...S.printLogRows, ...newRows];
      S.printLogOffset += newRows.length;
      S.printLogHasMore = Boolean(rows.hasMore);
      S.printLogLoaded = true;
      renderPrintLog();
      elSet('print-log-status', summary.generatedAt ? `Aktualizováno ${fmtDT(summary.generatedAt)}` : 'Data ze serveru');
    } catch (err) {
      if (wrap) {
        wrap.innerHTML = `<div class="empty-state"><div class="empty-state-icon">?</div><p>Nepodarilo se nacíst tiskový log.</p><div class="table-empty-note">${esc(err.message || err)}</div></div>`;
      }
      elSet('print-log-status', 'Chyba nacítání');
      showToast('Tiskový log: ' + (err.message || err), 'error');
    } finally {
      S.printLogLoading = false;
    }
  }

  function renderPrintLog() {
    renderPrintLogSummary();
    renderPrintLogComparison();
    renderPrintLogRows();
  }

  function renderPrintLogSummary() {
    const summary = S.printLogSummary || {};
    const lifecycle = getPrintLogLifecycleMetrics();
    elSet('pl-done-jobs', fmtInt(summary.doneJobs));
    elSet('pl-aborted-jobs', fmtInt(summary.abortedJobs));
    elSet('pl-deleted-jobs', fmtInt(summary.deletedJobs));
    elSet('pl-printed-area', fmtMeasure(summary.printedAreaM2, 'm²', 2));
    elSet('pl-media-length', fmtMeasure(summary.mediaLengthM, 'm', 2));
    elSet('pl-duration', fmtDuration(summary.totalDurationSec));
    elSet('pl-sla-total', fmtInt(lifecycle.totalGroups));
    elSet('pl-sla-first-pass', fmtInt(lifecycle.firstPassCount));
    elSet('pl-sla-first-rate', `${fmtN(lifecycle.firstPassRate, 1)} %`);
    elSet('pl-sla-resolved', fmtInt(lifecycle.resolvedAfterRetryCount));
    elSet('pl-sla-open', fmtInt(lifecycle.unresolvedCount));
    elSet('pl-sla-attempts', fmtN(lifecycle.avgAttempts, 2));
    elSet('pl-sla-attempts-success', fmtN(lifecycle.avgAttemptsSuccess, 2));
    elSet('pl-compare-range', printLogRangeLabel());
  }

  function renderPrintLogComparison() {
    const compare = S.printLogSummary?.byPrinter || {};
    const printers = Object.keys(compare);
    const grid = el('pl-compare-grid');
    if (!grid) return;
    grid.innerHTML = printers.map(name => {
      const rec = compare[name] || {};
      const displayName = mapPrinterName(name);
      return `<div class="metric-block">
        <span class="metric-big">${fmtInt(rec.doneJobs || 0)}</span>
        <span class="metric-unit">${esc(displayName)}</span>
        <span class="metric-desc">Hotovo · ${fmtMeasure(rec.printedAreaM2 || 0, 'm²', 2)} · ${fmtMeasure(rec.mediaLengthM || 0, 'm', 2)}</span>
      </div>`;
    }).join('');
  }

  function renderPrintLogRows() {
    const wrap = el('print-log-table-wrap');
    const foot = el('print-log-footnote');
    if (!wrap) return;
    if (S.printLogViewMode === 'grouped') return renderPrintLifecycleGroups(wrap, foot);
    if (!S.printLogRows.length) {
      wrap.innerHTML = `<div class="empty-state"><div class="empty-state-icon">??</div><p>Žádné tiskové úlohy neodpovídají filtru.</p></div>`;
      if (foot) foot.textContent = '0 rádku';
      return;
    }

    const rows = S.printLogRows.map(row => `<tr>
      <td>${fmtDT(row.readyAt)}</td>
      <td>${esc(mapPrinterName(row.printerName))}</td>
      <td>${esc(row.jobName || '—')}</td>
      <td><span class="result-badge ${printResultClass(row.result)}">${esc(printResultLabel(row.result))}</span></td>
      <td>${esc(row.mediaType || '—')}</td>
      <td class="num">${fmtMeasure(row.printedAreaM2, 'm²', 2)}</td>
      <td class="num">${fmtDurationSeconds(row.durationSec)}</td>
      <td class="note-td">${esc(row.sourceFile || '—')}</td>
    </tr>`).join('');

    const loadMoreBtn = S.printLogHasMore ? `<div class="print-log-load-more-wrap"><button id="pl-load-more" class="print-log-load-more">Nacíst další záznamy</button></div>` : '';

    wrap.innerHTML = `<table class="data-table">
      <thead><tr>
        <th>Cas pripravení</th>
        <th>Tiskárna</th>
        <th>Úloha</th>
        <th>Výsledek</th>
        <th>Médium</th>
        <th>Tištená plocha</th>
        <th>Doba tisku</th>
        <th>Zdrojový soubor</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
    ${loadMoreBtn}`;

    if (foot) foot.textContent = `Celkem ${S.printLogRows.length} rádku`;
  }

  function renderPrintLifecycleGroups(wrap, foot) {
    const groups = getFilteredLifecycleGroups();
    if (!groups.length) {
      wrap.innerHTML = `<div class="empty-state"><div class="empty-state-icon">??</div><p>Žádné skupiny prubehu neodpovídají filtru.</p></div>`;
      if (foot) foot.textContent = lifecycleFilterLabel(S.printLogGroupFilter);
      return;
    }

    const rows = groups.map(group => {
      const expanded = !!S.printLogExpandedGroups[group.id];
      const detailRows = group.attempts.map(attempt => `<tr>
        <td>${fmtDT(attempt.readyAt)}</td>
        <td><span class="result-badge ${printResultClass(attempt.result)}">${esc(printResultLabel(attempt.result))}</span></td>
        <td class="num">${fmtDurationSeconds(attempt.durationSec)}</td>
        <td class="num">${fmtMeasure(attempt.printedAreaM2, 'm²', 2)}</td>
        <td>${esc(attempt.mediaType || '—')}</td>
        <td class="note-td">${esc(attempt.sourceFile || '—')}</td>
      </tr>`).join('');
      return `<tbody class="pl-group-body ${expanded ? 'expanded' : ''}">
        <tr class="pl-group-row" data-group-id="${esc(group.id)}">
          <td>${fmtDT(group.latestReadyAt)}</td>
          <td>${esc(mapPrinterName(group.printerName))}</td>
          <td>${esc(group.jobName || '—')}<div class="pl-subline">${esc(group.explanation)}</div></td>
          <td><span class="result-badge lifecycle ${group.lifecycleStatus}">${esc(printLifecycleBadgeLabel(group.lifecycleStatus))}</span></td>
          <td class="num">${fmtInt(group.attemptCount)}</td>
          <td>${esc(group.finalResult)}</td>
          <td class="num">${fmtMeasure(group.finalPrintedAreaM2, 'm²', 2)}</td>
          <td>${esc(group.mediaType || '—')}</td>
          <td class="note-td">${esc(group.sourceFile || '—')}</td>
        </tr>
        <tr class="pl-group-detail-row ${expanded ? '' : 'hidden'}">
          <td colspan="9">
            <div class="pl-group-detail">
              <div class="pl-detail-head">
                <strong>${esc(group.explanation)}</strong>
                <span>${group.attemptCount} pokusu · ${fmtDuration(group.totalDurationSec)} · ${fmtMeasure(group.totalPrintedAreaM2, 'm²', 2)}</span>
              </div>
              <table class="data-table pl-detail-table">
                <thead><tr><th>Cas</th><th>Výsledek</th><th>Doba</th><th>Tištená plocha</th><th>Médium</th><th>Zdrojový soubor</th></tr></thead>
                <tbody>${detailRows}</tbody>
              </table>
            </div>
          </td>
        </tr>
      </tbody>`;
    }).join('');

    const loadMoreBtn = S.printLogHasMore ? `<div class="print-log-load-more-wrap"><button id="pl-load-more" class="print-log-load-more">Nacíst další záznamy</button></div>` : '';
    wrap.innerHTML = `<table class="data-table pl-group-table">
      <thead><tr><th>Poslední pokus</th><th>Tiskárna</th><th>Úloha</th><th>Stav</th><th>Pokusy</th><th>Finální výsledek</th><th>Finální plocha</th><th>Médium</th><th>Zdroj</th></tr></thead>
      ${rows}
    </table>${loadMoreBtn}`;

    if (foot) foot.textContent = `${groups.length} skupin prubehu · ${lifecycleFilterLabel(S.printLogGroupFilter)}${S.printLogHasMore ? ' · z nactených dat' : ''}`;
  }

  function printLogRangeLabel() {
    if (S.printLogDateFrom || S.printLogDateTo) {
      return `${S.printLogDateFrom || '…'} ? ${S.printLogDateTo || '…'}`;
    }
    return 'celé dostupné období';
  }

  function printResultClass(result) {
    const norm = String(result || '').toLowerCase();
    if (norm === 'done') return 'done';
    if (norm === 'abrt' || norm === 'aborted') return 'abrt';
    if (norm === 'deleted') return 'deleted';
    return '';
  }

  function printResultLabel(result) {
    const norm = String(result || '').trim().toLowerCase();
    if (norm === 'done') return 'Hotovo';
    if (norm === 'abrt' || norm === 'aborted') return 'Prerušeno';
    if (norm === 'deleted') return 'Smazáno';
    return result || '—';
  }

  function fmtInt(n) {
    if (n === null || n === undefined || isNaN(n)) return '0';
    return String(Math.round(Number(n)));
  }

  function fmtMeasure(n, unit, dec = 1) {
    if (n === null || n === undefined || isNaN(n)) return '—';
    return `${Number(n).toFixed(dec)} ${unit}`;
  }

  function fmtDuration(totalSec) {
    const sec = Math.max(0, Number(totalSec) || 0);
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`;
    return `${m}m`;
  }

  function fmtDurationSeconds(totalSec) {
    const sec = Math.max(0, Number(totalSec) || 0);
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = Math.floor(sec % 60);
    if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    return `${m}:${String(s).padStart(2, '0')}`;
  }

  return {
    PRINT_LOG_PAGE_SIZE,
    PRINT_LOG_LIFECYCLE_GAP_MS,
    mapPrinterName,
    getPrintLogParams,
    fetchPrintLogSummary,
    fetchPrintLogRows,
    normalizePrintLogText,
    normalizePrintLogSourceFile,
    normalizePrintLogResult,
    lifecycleFilterLabel,
    derivePrintLifecycleStatus,
    printLifecycleExplanation,
    printLifecycleBadgeLabel,
    printLifecycleFinalResult,
    buildPrintLifecycleGroups,
    getPrintLogLifecycleGroups,
    getFilteredLifecycleGroups,
    getPrintLogLifecycleMetrics,
    loadPrintLog,
    renderPrintLog,
    renderPrintLogSummary,
    renderPrintLogComparison,
    renderPrintLogRows,
    renderPrintLifecycleGroups,
    printLogRangeLabel,
    printResultClass,
    printResultLabel,
    fmtInt,
    fmtMeasure,
    fmtDuration,
    fmtDurationSeconds,
  };
}