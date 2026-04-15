(function (global) {
  const root = global.PrintGuardReports || (global.PrintGuardReports = {});

  function normalizePrintLogText(value) {
    return String(value || '')
      .trim()
      .toLowerCase()
      .replace(/\.[a-z0-9]{1,6}$/i, '')
      .replace(/[_-]+/g, ' ')
      .replace(/\s+/g, ' ');
  }

  function normalizePrintLogSourceFile(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    const last = raw.split(/[\\/]/).pop() || raw;
    return normalizePrintLogText(last);
  }

  function normalizePrintLogResult(result) {
    const normalized = String(result || '').trim().toLowerCase();
    if (normalized === 'done') return 'done';
    if (normalized === 'deleted') return 'deleted';
    if (normalized === 'abrt' || normalized === 'aborted') return 'abrt';
    return normalized || 'unknown';
  }

  function derivePrintLifecycleStatus(attempts) {
    const results = attempts.map(attempt => normalizePrintLogResult(attempt.result));
    const doneIndex = results.reduce((acc, result, index) => (result === 'done' ? index : acc), -1);
    const hasDone = doneIndex >= 0;
    const failBeforeDone = hasDone && results.slice(0, doneIndex).some(result => result === 'deleted' || result === 'abrt');
    const doneCount = results.filter(result => result === 'done').length;
    const deletedCount = results.filter(result => result === 'deleted').length;
    const abortedCount = results.filter(result => result === 'abrt').length;

    if (hasDone && failBeforeDone) return 'resolved_after_retry';
    if (hasDone && doneCount === 1 && attempts.length === 1) return 'success_first_try';
    if (hasDone && doneCount > 1 && !results.some(result => result === 'deleted' || result === 'abrt')) return 'multiple_attempts_success';
    if (hasDone && doneCount >= 1 && attempts.length > 1 && !failBeforeDone) return 'multiple_attempts_success';
    if (!hasDone && deletedCount === attempts.length && attempts.length) return 'deleted_only';
    if (!hasDone && abortedCount === attempts.length && attempts.length) return 'aborted_only';
    if (!hasDone && (deletedCount > 0 || abortedCount > 0)) return 'open_issue';
    return 'unresolved';
  }

  function buildPrintLifecycleGroups(rows, options) {
    const gapMs = Math.max(1, Number(options?.gapMs) || (2 * 60 * 60 * 1000));
    const sorted = [...(rows || [])].sort((a, b) => new Date(a.readyAt) - new Date(b.readyAt));
    const groups = [];
    const buckets = new Map();

    sorted.forEach(row => {
      const jobKey = normalizePrintLogText(row.jobName);
      const sourceKey = normalizePrintLogSourceFile(row.sourceFile);
      const baseKey = [
        row.printerName || '',
        normalizePrintLogText(row.mediaType),
        sourceKey || jobKey,
        jobKey || sourceKey || 'unknown',
      ].join('||');
      const jobSignature = [
        row.jobId ? `job_id=${row.jobId}` : '',
        row.documentId ? `document_id=${row.documentId}` : '',
        row.sourceFile ? `source_file=${row.sourceFile}` : '',
        row.jobName ? `job_name=${row.jobName}` : '',
      ].filter(Boolean).join(' | ');

      const readyMs = new Date(row.readyAt).getTime();
      const bucket = buckets.get(baseKey) || [];
      let group = bucket[bucket.length - 1];

      if (!group || !Number.isFinite(readyMs) || !Number.isFinite(group.lastReadyMs) || (readyMs - group.lastReadyMs) > gapMs) {
        group = {
          id: `${baseKey}__${readyMs || Date.now()}__${groups.length}`,
          attempts: [],
          lastReadyMs: readyMs,
          printerName: row.printerName || '',
          mediaType: row.mediaType || '',
          sourceFile: row.sourceFile || '',
          jobId: row.jobId || '',
          documentId: row.documentId || '',
          jobSignature,
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
      group.jobId = group.jobId || row.jobId || '';
      group.documentId = group.documentId || row.documentId || '';
    });

    return groups.map(group => {
      const attempts = [...group.attempts].sort((a, b) => new Date(a.readyAt) - new Date(b.readyAt));
      const latest = attempts[attempts.length - 1] || {};
      const successfulAttempts = attempts.filter(attempt => normalizePrintLogResult(attempt.result) === 'done');
      const lifecycleStatus = derivePrintLifecycleStatus(attempts);
      const finalArea = successfulAttempts.length
        ? successfulAttempts[successfulAttempts.length - 1].printedAreaM2
        : latest.printedAreaM2;
      const finalResultCode = normalizePrintLogResult(latest.result);

      return {
        id: group.id,
        attempts,
        attemptCount: attempts.length,
        latestReadyAt: latest.readyAt || null,
        printerName: latest.printerName || group.printerName,
        jobName: latest.jobName || group.jobName,
        jobId: latest.jobId || group.jobId || '',
        documentId: latest.documentId || group.documentId || '',
        jobSignature: latest.jobSignature || group.jobSignature || '',
        mediaType: latest.mediaType || group.mediaType,
        sourceFile: latest.sourceFile || group.sourceFile,
        lifecycleStatus,
        finalResultCode,
        finalPrintedAreaM2: finalArea == null ? null : Number(finalArea),
        totalPrintedAreaM2: attempts.reduce((sum, attempt) => sum + (Number(attempt.printedAreaM2) || 0), 0),
        mediaLengthM: attempts.reduce((sum, attempt) => sum + (Number(attempt.mediaLengthM) || 0), 0),
        totalDurationSec: attempts.reduce((sum, attempt) => sum + (Number(attempt.durationSec) || 0), 0),
        isSuccessful: finalResultCode === 'done',
      };
    }).sort((a, b) => new Date(b.latestReadyAt) - new Date(a.latestReadyAt));
  }

  function buildPrintErrorSummary(groups) {
    const rows = groups || [];
    const successful = rows.filter(group => group.isSuccessful);
    const firstPass = rows.filter(group => group.lifecycleStatus === 'success_first_try');
    const resolvedRetries = rows.filter(group => group.lifecycleStatus === 'resolved_after_retry');
    const unresolved = rows.filter(group => ['open_issue', 'deleted_only', 'aborted_only', 'unresolved'].includes(group.lifecycleStatus));
    const avgAttempts = rows.length ? rows.reduce((sum, group) => sum + group.attemptCount, 0) / rows.length : 0;
    const avgAttemptsSuccess = successful.length
      ? successful.reduce((sum, group) => sum + group.attemptCount, 0) / successful.length
      : 0;

    return {
      totalGroups: rows.length,
      firstPassCount: firstPass.length,
      firstPassRate: rows.length ? (firstPass.length / rows.length) * 100 : 0,
      resolvedAfterRetryCount: resolvedRetries.length,
      unresolvedCount: unresolved.length,
      avgAttempts,
      avgAttemptsSuccess,
    };
  }

  function buildPrintLogSummary(summary, options) {
    const byPrinter = summary?.byPrinter || {};
    const ratioMap = options?.printerInkRatioMap || {};
    let estimatedInk = 0;
    let hasEstimate = false;

    Object.entries(byPrinter).forEach(([printerName, record]) => {
      const ratio = ratioMap[printerName];
      const area = Number(record?.printedAreaM2);
      if (!Number.isFinite(area) || area <= 0 || !Number.isFinite(ratio)) return;
      estimatedInk += area * ratio;
      hasEstimate = true;
    });

    const directInk = summary?.inkDataAvailable ? Number(summary?.inkTotalL) : null;

    return {
      doneJobs: Number(summary?.doneJobs || 0),
      abortedJobs: Number(summary?.abortedJobs || 0),
      deletedJobs: Number(summary?.deletedJobs || 0),
      printedAreaM2: Number(summary?.printedAreaM2 || 0),
      mediaLengthM: Number(summary?.mediaLengthM || 0),
      totalDurationSec: Number(summary?.totalDurationSec || 0),
      inkL: Number.isFinite(directInk) ? directInk : (hasEstimate ? estimatedInk : null),
      inkSource: Number.isFinite(directInk) ? 'direct' : (hasEstimate ? 'estimated' : null),
      byPrinter,
    };
  }

  const api = {
    normalizePrintLogResult,
    buildPrintLifecycleGroups,
    buildPrintErrorSummary,
    buildPrintLogSummary,
  };

  root.printLog = api;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
