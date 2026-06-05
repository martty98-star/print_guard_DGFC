'use strict';

(() => {
  const XML_EXPECTED_THRESHOLD_MINUTES = 60;
  const XML_MISSING_THRESHOLD_MINUTES = 90;

  function t(key) {
    return window.I18N && typeof window.I18N.t === 'function' ? window.I18N.t(key) : key;
  }

  function fileNameFromPath(value) {
    const raw = String(value || '');
    return raw.split(/[\\/]/).filter(Boolean).pop() || raw;
  }

  function isToday(date) {
    const now = new Date();
    return date.getFullYear() === now.getFullYear()
      && date.getMonth() === now.getMonth()
      && date.getDate() === now.getDate();
  }

  function formatPipelineDateTime(value) {
    if (!value) return '-';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    const hh = String(date.getHours()).padStart(2, '0');
    const min = String(date.getMinutes()).padStart(2, '0');
    if (isToday(date)) return `${hh}:${min}`;
    const dd = String(date.getDate()).padStart(2, '0');
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const yyyy = date.getFullYear();
    return `${dd}.${mm}.${yyyy} ${hh}:${min}`;
  }

  function getPageSizes(row) {
    if (row && row.pageSizes) return row.pageSizes;
    const values = (Array.isArray(row && row.printFiles) ? row.printFiles : [])
      .map(file => file.pageSize)
      .filter(Boolean);
    return Array.from(new Set(values)).join(', ') || '-';
  }

  function formatPdfCount(count) {
    const value = Number(count) || 0;
    return `${value} PDF`;
  }

  function getOrderTypeInfo(row) {
    const normalized = String(row && row.orderType || '').trim().toUpperCase();
    if (normalized === 'RC') return { label: 'RC', className: 'reprint-combi is-reprint-combi' };
    if (normalized === 'RS') return { label: 'RS', className: 'reprint-single is-reprint-single' };
    if (normalized === 'R') return { label: 'R', className: 'reprint is-reprint' };
    if (normalized === 'C') return { label: t('processed.order-type.combi'), className: 'combi is-combi' };
    if (normalized === 'S' || !normalized) return { label: t('processed.order-type.single'), className: 'single is-single' };
    return { label: '', className: '' };
  }

  function normalizePrintFiles(row) {
    return Array.isArray(row && row.printFiles) ? row.printFiles : [];
  }

  function getPipelineAgeMinutes(row) {
    const value = row && (row.receivedAt || row.apiSeenAt);
    if (!value) return 0;
    const time = new Date(value).getTime();
    return Number.isFinite(time) ? (Date.now() - time) / 60000 : 0;
  }

  function getXmlStatus(row) {
    if (!row || row.pipelineStatus !== 'received_only') return '';
    const ageMinutes = getPipelineAgeMinutes(row);
    if (ageMinutes < XML_EXPECTED_THRESHOLD_MINUTES) return 'Waiting';
    if (ageMinutes < XML_MISSING_THRESHOLD_MINUTES) return 'Expected';
    return 'Missing';
  }

  function formatPrintedOutMeta(row) {
    if (!row || !row.physicallyPrintedAt) return '';
    const parts = [formatPipelineDateTime(row.physicallyPrintedAt)];
    if (row.physicallyPrintedBy) parts.push(row.physicallyPrintedBy);
    if (row.physicallyPrintedStation) parts.push(row.physicallyPrintedStation);
    return parts.filter(Boolean).join(' · ');
  }

  function formatFileSize(value) {
    return String(value || '').trim() || '-';
  }

  function xmlStatusClass(status) {
    const normalized = String(status || '').toLowerCase();
    if (normalized === 'missing') return 'missing';
    if (normalized === 'expected') return 'reprint';
    return 'received';
  }

  function isReprintRow(row) {
    return row && String(row.orderType || '').toUpperCase().startsWith('R');
  }

  function cleanLabel(value) {
    return String(value == null ? '' : value).trim();
  }

  function getInternalOrderIds(row) {
    return new Set([
      row && row.id,
      row && row.processedOrderId,
      row && row.processed_order_id,
    ].map(cleanLabel).filter(Boolean));
  }

  function isInternalOrderIdLabel(row, value) {
    const label = cleanLabel(value);
    return Boolean(label && getInternalOrderIds(row).has(label));
  }

  function isPrefixedOrderLabel(value) {
    return /^[A-Z]+\s*[-_]?\s*\d{4,}$/i.test(cleanLabel(value));
  }

  function getBusinessOrderLabels(row) {
    if (!row) return [];
    const labels = [
      row.processedOrderName,
      row.processed_order_name,
      row.orderName,
      row.order_name,
      row.externalOrderId,
      row.external_order_id,
      row.orderNumber,
      row.order_number,
      row.customerOrderId,
      row.customer_order_id,
      row.receivedOrderId,
      row.received_order_id,
      row.displayOrderName,
    ]
      .map(cleanLabel)
      .filter(Boolean)
      .filter((value) => !isInternalOrderIdLabel(row, value));
    const unique = labels.filter((value, index, list) => list.indexOf(value) === index);
    return [
      ...unique.filter(isPrefixedOrderLabel),
      ...unique.filter((value) => !isPrefixedOrderLabel(value)),
    ];
  }

  function getPrimaryOrderLabel(row) {
    return getBusinessOrderLabels(row)[0] || '';
  }

  function getRawOrderLabels(row) {
    return getBusinessOrderLabels(row);
  }

  function getSecondaryOrderLabels(row, primaryLabel) {
    const labels = getRawOrderLabels(row)
      .filter(Boolean)
      .filter((value, index, list) => list.indexOf(value) === index)
      .filter((value) => value !== primaryLabel);
    return labels;
  }

  function getAttentionState(row) {
    if (row && (row.pipelineStatus === 'cancelled' || row.adminStatus === 'cancelled')) return 'cancelled';
    const status = String(row && row.pipelineStatus || '').toLowerCase();
    if (status === 'received_only') return 'unprocessed';
    if (status === 'processed_without_received') return 'orphan';
    if (status === 'reprint_pending' || Boolean(row && row.reprintPending)) return 'reprint';
    return '';
  }

  function getAttentionPriority(row) {
    const state = getAttentionState(row);
    if (state === 'unprocessed') return 0;
    if (state === 'orphan') return 1;
    if (state === 'reprint') return 2;
    return 3;
  }

  function statNumber(stats, key) {
    const value = Number(stats && stats[key]);
    return Number.isFinite(value) ? value : 0;
  }

  function renderStatItem(stats, key, labelKey, className) {
    const global = stats && stats.global;
    const scope = stats && stats.scope;
    const globalValue = statNumber(global, key);
    const scopeValue = statNumber(scope, key);
    const scopeHtml = scope && scopeValue !== globalValue
      ? `<small>${t('processed.summary.scope')}: ${scopeValue}</small>`
      : '';
    return `<div class="pp-status-summary-item ${className}">
      <span class="pp-status-summary-label">${t(labelKey)}</span>
      <strong>${globalValue}</strong>
      ${scopeHtml}
    </div>`;
  }

  function renderDebugStatItem(stats, key, labelKey) {
    const global = stats && stats.global;
    const scope = stats && stats.scope;
    const globalValue = statNumber(global, key);
    const scopeValue = statNumber(scope, key);
    const scopeHtml = scope && scopeValue !== globalValue
      ? `<span>${t('processed.summary.scope')}: ${scopeValue}</span>`
      : '';
    return `<div class="pp-debug-stat">
      <span>${t(labelKey)}</span>
      <strong>${globalValue}</strong>
      ${scopeHtml}
    </div>`;
  }

  function renderPipelineStats(stats, options) {
    if (!stats || !stats.global) return '';
    const debugMetrics = options && options.isAdmin
      ? `<details class="pp-debug-summary admin-only">
          <summary>${t('processed.summary.debug')}</summary>
          <div class="pp-debug-summary-grid">
            ${renderDebugStatItem(stats, 'needsAttention', 'processed.summary.legacy-technical')}
            ${renderDebugStatItem(stats, 'noApiMatch', 'processed.summary.no-api-match')}
          </div>
        </details>`
      : '';
    return `<div class="pp-status-summary" aria-label="${t('processed.summary.operational')}">
      ${renderStatItem(stats, 'unprocessed', 'processed.summary.unprocessed', 'is-unprocessed')}
      ${renderStatItem(stats, 'reprintBacklog', 'processed.summary.reprint-backlog', 'is-reprint')}
    </div>${debugMetrics}`;
  }

  function renderPipelineBadges(row) {
    const badges = [];
    if (row.pipelineStatus === 'cancelled' || row.adminStatus === 'cancelled') {
      badges.push(`<span class="pp-pipeline-badge cancelled">${t('processed.badge.cancelled')}</span>`);
    }
    if (row.physicallyPrintedAt) {
      badges.push(`<span class="pp-pipeline-badge done">${t('processed.badge.printed-out')}</span>`);
    }
    if (Array.isArray(row.printFiles) && row.printFiles.length) {
      badges.push('<span class="pp-pipeline-badge pdf">PDF</span>');
    }
    if (row.reprintPending || row.pipelineStatus === 'reprint_pending') {
      badges.push(`<span class="pp-pipeline-badge reprint">${t('processed.badge.reprint-pending')}</span>`);
    } else if (row.reprintRequestCount > 0 || row.reprintRecordCount > 0) {
      badges.push(`<span class="pp-pipeline-badge reprint">${t('processed.badge.reprint-requested')}</span>`);
    }
    const xmlStatus = getXmlStatus(row);
    if (xmlStatus) {
      badges.push(`<span class="pp-pipeline-badge ${xmlStatusClass(xmlStatus)}">${xmlStatus}</span>`);
    }
    if (row.pipelineStatus === 'processed_without_received') {
      badges.push(`<span class="pp-pipeline-badge orphan">${t('processed.badge.no-api-match')}</span>`);
    }
    return badges.join('');
  }

  function getOrderCardStatus(row, options, allHistory) {
    const reprintState = String(getRowReprintState(row, options || {}).state || '');
    const latestReprint = getLatestReprintEntry(allHistory);
    const activeReprints = (Array.isArray(allHistory) ? allHistory : []).filter((entry) => isPendingReprintStatus(entry && entry.status));
    if (row.pipelineStatus === 'cancelled' || row.adminStatus === 'cancelled') {
      return { label: t('processed.card.cancelled'), badgeClass: 'cancelled' };
    }
    if (reprintState === 'resolving') {
      return { label: t('processed.status.resolving'), badgeClass: 'processed' };
    }
    if (reprintState === 'error') {
      return { label: t('processed.status.resolve-failed'), badgeClass: 'error' };
    }
    if (activeReprints.some((entry) => entry && entry.matchedRecord)) {
      return { label: t('processed.reprint.status.in-production'), badgeClass: 'processed' };
    }
    if (activeReprints.length || row.reprintPending || row.pipelineStatus === 'reprint_pending' || reprintState === 'pending') {
      return { label: t('processed.reprint.status.waiting'), badgeClass: 'reprint' };
    }
    if (latestReprint && isDoneReprintStatus(latestReprint.status)) {
      return { label: t('processed.reprint.status.done'), badgeClass: 'done' };
    }
    if (row.physicallyPrintedAt) {
      return { label: t('processed.card.printed-out'), badgeClass: 'done' };
    }
    if (row.pipelineStatus === 'received_only') {
      return { label: t('processed.card.waiting-production'), badgeClass: xmlStatusClass(getXmlStatus(row) || 'received') };
    }
    if (row.pipelineStatus === 'processed_without_received') {
      return { label: t('processed.status.no-api-match'), badgeClass: 'orphan' };
    }
    return { label: t('processed.card.in-production'), badgeClass: 'processed' };
  }

  function renderOrderHeaderChips(row, allHistory, esc) {
    const files = normalizePrintFiles(row);
    const fileCount = files.length || Number(row && row.printFileCount) || 0;
    const orderType = getOrderTypeInfo(row);
    const chips = [];
    if (orderType.label) {
      chips.push(`<span class="pp-order-chip ${orderType.className}">${esc(orderType.label)}</span>`);
    }
    chips.push(`<span class="pp-order-chip pdf-count">${esc(formatPdfCount(fileCount))}</span>`);
    if (hasFullOrderReprint(allHistory)) {
      chips.push(`<span class="pp-order-chip reprint-full">${t('processed.reprint.badge.full-order')}</span>`);
    } else if (row.reprintPending || (Array.isArray(allHistory) ? allHistory : []).some((entry) => isPendingReprintStatus(entry && entry.status))) {
      chips.push(`<span class="pp-order-chip reprint-active">${t('processed.reprint.badge.active')}</span>`);
    }
    if (row.physicallyPrintedAt) {
      chips.push(`<span class="pp-order-chip done">${t('processed.card.printed-out')}</span>`);
    }
    return `<div class="pp-order-chip-row">${chips.join('')}</div>`;
  }

  function renderActionNeeded(row, options) {
    if (row.pipelineStatus === 'cancelled' || row.adminStatus === 'cancelled') {
      return `<span class="pp-pipeline-badge cancelled">${t('processed.badge.cancelled')}</span><span>${options.esc(row.adminNote || t('processed.action.cancelled-text'))}</span>`;
    }
    const state = getRowReprintState(row, options);
    if (state.state === 'resolving' || state.state === 'resolved' || state.state === 'error') {
      return renderReprintStateBlock(row, state, options);
    }
    if (state.state === 'pending' || row.reprintPending) {
      return `<span class="pp-action-text">${t('processed.action.reprint-pending-text')}</span>`;
    }
    const xmlStatus = getXmlStatus(row);
    if (xmlStatus) return `<span class="pp-action-text">${t('processed.action.none-text')}</span>`;
    return `<span class="pp-action-text">${t('processed.action.none-text')}</span>`;
  }

  function getReprintKey(orderId, printFilePath) {
    return `${orderId || ''}::${printFilePath || '__FULL_REPRINT__'}`;
  }

  function getFileHistory(orderId, printFilePath, options) {
    const history = options.reprintHistoryByKey && options.reprintHistoryByKey.get(getReprintKey(orderId, printFilePath));
    return Array.isArray(history) ? history : [];
  }

  function isDoneReprintStatus(status) {
    const normalized = String(status || '').toLowerCase();
    return normalized === 'done' || normalized === 'completed' || normalized === 'resolved';
  }

  function isPendingReprintStatus(status) {
    return String(status || '').toLowerCase() === 'pending';
  }

  function isFullOrderReprint(entry) {
    return !String(entry && entry.printFilePath || '').trim();
  }

  function getAllRowHistory(row, options) {
    const orderId = row && (row.processedOrderId || row.id);
    if (!orderId) return [];
    const keys = [getReprintKey(orderId, '')];
    if (Array.isArray(row && row.printFiles)) {
      row.printFiles.forEach((file) => {
        keys.push(getReprintKey(orderId, file && file.printFilePath || ''));
      });
    }
    const seen = new Set();
    return keys.flatMap((key) => {
      const items = options.reprintHistoryByKey && options.reprintHistoryByKey.get(key);
      return Array.isArray(items) ? items : [];
    }).filter((entry) => {
      const id = String(entry && entry.id || '');
      if (!id || seen.has(id)) return false;
      seen.add(id);
      return true;
    });
  }

  function getLatestReprintEntry(entries) {
    return (Array.isArray(entries) ? entries : [])
      .slice()
      .sort((a, b) => toTimeValue(b && (b.confirmedAt || b.requestedAt)) - toTimeValue(a && (a.confirmedAt || a.requestedAt)) || Number(b && b.id || 0) - Number(a && a.id || 0))[0] || null;
  }

  function hasFullOrderReprint(entries) {
    return (Array.isArray(entries) ? entries : []).some(isFullOrderReprint);
  }

  function getPrintFileForPath(row, path) {
    const wanted = normalizeReprintPath(path);
    return normalizePrintFiles(row).find((file) => normalizeReprintPath(file && file.printFilePath) === wanted) || null;
  }

  function getPdfMetaForEntry(row, entry) {
    const files = normalizePrintFiles(row);
    const fileCount = files.length || Number(row && row.printFileCount) || 0;
    if (isFullOrderReprint(entry)) {
      return {
        label: `${t('processed.reprint.pdf.full-order')} / ${formatPdfCount(fileCount)}`,
        size: '',
      };
    }
    const file = getPrintFileForPath(row, entry && entry.printFilePath);
    return {
      label: fileNameFromPath(entry && entry.printFilePath) || '-',
      size: file ? formatFileSize(file.pageSize) : '',
    };
  }

  function getReprintScopeInfo(entry) {
    if (!entry) return { label: t('processed.reprint.scope.generic'), className: 'generic' };
    if (isFullOrderReprint(entry)) return { label: t('processed.reprint.scope.full-order'), className: 'full' };
    return { label: t('processed.reprint.scope.single-poster'), className: 'single' };
  }

  function getFileReprintMarker(row, file, options, allHistory) {
    const orderId = row && (row.processedOrderId || row.id);
    const path = file && file.printFilePath || '';
    const fileHistory = getFileHistory(orderId, path, options);
    if (fileHistory.length) {
      return {
        label: t('processed.reprint.badge.this-pdf'),
        className: 'reprint',
        active: fileHistory.some((entry) => isPendingReprintStatus(entry && entry.status)),
      };
    }
    if (hasFullOrderReprint(allHistory)) {
      return {
        label: t('processed.reprint.badge.included'),
        className: 'reprint',
        active: (Array.isArray(allHistory) ? allHistory : []).some((entry) => isFullOrderReprint(entry) && isPendingReprintStatus(entry && entry.status)),
      };
    }
    return null;
  }

  function getReprintActionState(orderId, printFilePath, options) {
    const key = getReprintKey(orderId, printFilePath);
    const local = options.reprintActionStateByKey && options.reprintActionStateByKey.get(key);
    if (local && local.state) {
      return {
        key,
        printFilePath: printFilePath || '',
        state: local.state,
        message: local.message || '',
      };
    }

    const history = getFileHistory(orderId, printFilePath, options);
    const pending = history.some((entry) => String(entry.status || '').toLowerCase() === 'pending')
      || Boolean(options.reprintPendingKeys && options.reprintPendingKeys.has(key));
    if (pending) {
      return { key, printFilePath: printFilePath || '', state: 'pending', message: '' };
    }

    return { key, printFilePath: printFilePath || '', state: 'idle', message: '' };
  }

  function getRowReprintState(row, options) {
    const orderId = row && (row.processedOrderId || row.id);
    if (!orderId) return { state: 'idle', key: '' };

    const candidates = [{ key: getReprintKey(orderId, ''), printFilePath: '' }];
    if (Array.isArray(row && row.printFiles)) {
      row.printFiles.forEach((file) => {
        candidates.push({ key: getReprintKey(orderId, file && file.printFilePath), printFilePath: file && file.printFilePath || '' });
      });
    }

    const states = candidates.map((candidate) => getReprintActionState(orderId, candidate.printFilePath, options));
    const precedence = ['error', 'resolving', 'resolved', 'pending', 'idle'];
    for (const stateName of precedence) {
      const found = states.find((entry) => entry.state === stateName);
      if (found) return found;
    }
    return { state: 'idle', key: getReprintKey(orderId, ''), printFilePath: '' };
  }

  function reprintStatusClass(status) {
    const normalized = String(status || '').toLowerCase();
    if (normalized === 'done' || normalized === 'completed' || normalized === 'resolved') return 'done';
    return 'reprint';
  }

  function toTimeValue(value) {
    if (!value) return 0;
    const time = new Date(value).getTime();
    return Number.isFinite(time) ? time : 0;
  }

  function normalizeReprintPath(value) {
    return String(value || '').trim().toLowerCase();
  }

  function getRecordProcessedAt(record) {
    return record && (record.processedAt || record.queuedDateTime) || '';
  }

  function getRecordPrintFiles(record) {
    return Array.isArray(record && record.printFiles) ? record.printFiles : [];
  }

  function recordMatchesRequest(record, request) {
    if (!record || !request) return false;
    const requestPath = normalizeReprintPath(request.printFilePath);
    if (!requestPath) return true;
    return getRecordPrintFiles(record).some((file) => normalizeReprintPath(file && (file.printFilePath || file.print_file_path)) === requestPath);
  }

  function matchReprintHistory(entries, records) {
    const requestList = (Array.isArray(entries) ? entries : [])
      .slice()
      .sort((a, b) => toTimeValue(a && a.requestedAt) - toTimeValue(b && b.requestedAt) || Number(a && a.id || 0) - Number(b && b.id || 0));
    const recordList = (Array.isArray(records) ? records : [])
      .slice()
      .sort((a, b) => toTimeValue(getRecordProcessedAt(a)) - toTimeValue(getRecordProcessedAt(b)) || Number(a && a.id || 0) - Number(b && b.id || 0));

    const usedRecordIds = new Set();
    const matched = requestList.map((entry, index) => {
      const requestedAtMs = toTimeValue(entry && entry.requestedAt);
      const matchedRecord = recordList.find((record) => {
        const recordId = String(record && record.id || '');
        if (recordId && usedRecordIds.has(recordId)) return false;
        if (!recordMatchesRequest(record, entry)) return false;
        const processedAtMs = toTimeValue(getRecordProcessedAt(record));
        if (requestedAtMs && processedAtMs && processedAtMs < requestedAtMs) return false;
        return true;
      }) || null;
      if (matchedRecord && matchedRecord.id != null) usedRecordIds.add(String(matchedRecord.id));
      return {
        ...entry,
        sequenceNumber: index + 1,
        matchedRecord,
      };
    });

    const unmatchedRecords = recordList.filter((record) => {
      const recordId = String(record && record.id || '');
      return !recordId || !usedRecordIds.has(recordId);
    });

    return {
      entries: matched,
      unmatchedRecords,
    };
  }

  function getOperationalReprintStatus(entry) {
    const normalized = String(entry && entry.status || '').toLowerCase();
    if (normalized === 'done' || normalized === 'completed' || normalized === 'resolved') {
      return { key: 'done', label: t('processed.reprint.status.done'), badgeClass: 'done' };
    }
    if (entry && entry.matchedRecord) {
      return { key: 'in_production', label: t('processed.reprint.status.in-production'), badgeClass: 'processed' };
    }
    return { key: 'waiting', label: t('processed.reprint.status.waiting'), badgeClass: 'reprint' };
  }

  function formatReprintReason(entry) {
    const reason = String(entry && entry.reason || '').trim();
    if (!reason) return '-';
    const key = `processed.reprint.reason.${reason.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
    const translated = t(key);
    return translated === key ? reason : translated;
  }

  function renderTimelineEvents(entry, esc) {
    const events = [
      {
        label: t('processed.reprint.timeline.requested'),
        at: entry && entry.requestedAt,
        by: entry && entry.requestedBy,
      },
    ];
    if (entry && entry.matchedRecord) {
      events.push({
        label: t('processed.reprint.timeline.xml-processed'),
        at: getRecordProcessedAt(entry.matchedRecord),
        by: '',
      });
    }
    if (entry && entry.confirmedAt) {
      events.push({
        label: t('processed.reprint.timeline.completed'),
        at: entry.confirmedAt,
        by: entry.confirmedBy || '',
      });
    }
    return `<div class="pp-reprint-timeline">
      ${events.filter((event) => event.at).map((event) => `<div class="pp-reprint-timeline-row">
        <strong>${esc(event.label)}</strong>
        <span>${esc(formatPipelineDateTime(event.at))}${event.by ? ` · ${esc(event.by)}` : ''}</span>
      </div>`).join('')}
    </div>`;
  }

  function renderReprintTechnicalDetails(entry, esc, row) {
    const record = entry && entry.matchedRecord;
    const files = getRecordPrintFiles(record);
    const fileNames = files
      .map((file) => fileNameFromPath(file && (file.printFilePath || file.print_file_path || '')))
      .filter(Boolean)
      .join(', ');
    const detailItems = [
      entry && entry.printFilePath ? { label: t('processed.reprint.tech.print-file'), value: entry.printFilePath } : null,
      entry && entry.workstationId ? { label: t('processed.reprint.tech.workstation'), value: entry.workstationId } : null,
      record && record.xmlFileName ? { label: t('processed.reprint.tech.xml-file'), value: record.xmlFileName } : null,
      record && record.orderName ? { label: t('processed.reprint.tech.order-name'), value: record.orderName } : null,
      record && record.status ? { label: t('processed.reprint.tech.record-status'), value: record.status } : null,
      record && getRecordProcessedAt(record) ? { label: t('processed.reprint.tech.processed-at'), value: formatPipelineDateTime(getRecordProcessedAt(record)) } : null,
      fileNames ? { label: 'PDF', value: fileNames } : null,
      record && record.sourceXmlPath ? { label: t('processed.reprint.tech.source-path'), value: record.sourceXmlPath } : null,
      row && row.workflowName ? { label: t('processed.label.workflow'), value: row.workflowName } : null,
    ].filter(Boolean);
    if (!detailItems.length) return '';
    return `<details class="pp-reprint-tech-details">
      <summary>${t('processed.section.technical-details')}</summary>
      <div class="pp-reprint-tech-grid">
        ${detailItems.map((item) => `<div class="pp-reprint-tech-item"><span>${esc(item.label)}</span><strong>${esc(item.value)}</strong></div>`).join('')}
      </div>
    </details>`;
  }

  function renderReprintActionState(row, printFilePath, options) {
    const esc = options.esc;
    const orderId = row.processedOrderId || row.id;
    const actionState = getReprintActionState(orderId, printFilePath, options);
    return renderReprintStateBlock(row, actionState, options);
  }

  function renderReprintStateBlock(row, actionState, options) {
    const esc = options.esc;
    const orderId = row.processedOrderId || row.id;
    if (actionState.state === 'resolving') {
      return `<div class="pp-reprint-action-state resolving">
        <span>${esc(actionState.message || t('processed.action.reprint-resolving-text'))}</span>
      </div>`;
    }
    if (actionState.state === 'resolved') {
      return `<div class="pp-reprint-action-state resolved">
        <span>${esc(actionState.message || t('processed.action.reprint-resolved-text'))}</span>
      </div>`;
    }
    if (actionState.state === 'error') {
      return `<div class="pp-reprint-action-state error">
        <span class="pp-pipeline-badge error">${t('processed.status.resolve-failed')}</span>
        <span>${esc(actionState.message || t('processed.action.reprint-error-text'))}</span>
        <button class="btn-sm" type="button" data-resolve-reprint-order-id="${esc(orderId || '')}" data-resolve-print-file-path="${esc(actionState.printFilePath || '')}">${t('processed.action.retry-resolve')}</button>
      </div>`;
    }
    if (actionState.state === 'pending') {
      return `<div class="pp-reprint-action-state pending">
        <span>${t('processed.action.reprint-pending-text')}</span>
      </div>`;
    }
    return '';
  }

  function renderReprintHistory(row, entries, esc, options) {
    const matched = matchReprintHistory(entries, row && row.reprintRecords);
    if (!matched.entries.length && !matched.unmatchedRecords.length) return '';
    const historyHtml = matched.entries.map((entry) => {
      const status = getOperationalReprintStatus(entry);
      const scope = getReprintScopeInfo(entry);
      const pdfMeta = getPdfMetaForEntry(row, entry);
      return `<div class="pp-reprint-history-entry">
        <div class="pp-reprint-history-top pp-reprint-history-top--workflow">
          <div>
            <div class="pp-reprint-title-line">
              <span>${t('processed.reprint.card-title')} #${esc(entry.sequenceNumber)}</span>
              <strong>${esc(scope.label)}</strong>
            </div>
            <strong>${esc(formatReprintReason(entry))}</strong>
          </div>
          <span class="pp-pipeline-badge ${status.badgeClass}">${esc(status.label)}</span>
        </div>
        <div class="pp-reprint-primary-grid">
          <div class="pp-reprint-primary-item"><span>PDF</span><strong>${esc(pdfMeta.label)}</strong></div>
          ${pdfMeta.size ? `<div class="pp-reprint-primary-item"><span>${t('processed.label.size')}</span><strong>${esc(pdfMeta.size)}</strong></div>` : ''}
          <div class="pp-reprint-primary-item"><span>${t('processed.reprint.field.reason')}</span><strong>${esc(formatReprintReason(entry))}</strong></div>
          <div class="pp-reprint-primary-item"><span>${t('processed.reprint.field.requested-by')}</span><strong>${esc(entry.requestedBy || '-')}</strong></div>
          <div class="pp-reprint-primary-item"><span>${t('processed.reprint.field.requested-at')}</span><strong>${esc(formatPipelineDateTime(entry.requestedAt))}</strong></div>
          <div class="pp-reprint-primary-item"><span>${t('processed.reprint.field.status')}</span><strong>${esc(status.label)}</strong></div>
          ${entry.confirmedBy ? `<div class="pp-reprint-primary-item"><span>${t('processed.reprint.field.confirmed-by')}</span><strong>${esc(entry.confirmedBy)}</strong></div>` : ''}
          ${entry.confirmedAt ? `<div class="pp-reprint-primary-item"><span>${t('processed.reprint.field.confirmed-at')}</span><strong>${esc(formatPipelineDateTime(entry.confirmedAt))}</strong></div>` : ''}
        </div>
        ${entry.note ? `<div class="pp-reprint-history-note">${esc(entry.note)}</div>` : ''}
        ${renderTimelineEvents(entry, esc)}
        ${renderReprintTechnicalDetails(entry, esc, row)}
        <div class="pp-file-actions">
          ${String(entry.status || '').toLowerCase() === 'pending' ? (() => {
            const actionState = getReprintActionState(entry.orderId, entry.printFilePath, options);
            const buttonLabel = actionState.state === 'resolving'
              ? t('processed.status.resolving')
              : t('processed.button.mark-reprinted');
            const buttonDisabled = actionState.state === 'resolving' ? 'disabled' : '';
            return `<button class="btn-sm" type="button" data-resolve-reprint-order-id="${esc(entry.orderId || '')}" data-resolve-print-file-path="${esc(entry.printFilePath || '')}" ${buttonDisabled}>${buttonLabel}</button><button class="btn-sm" type="button" data-delete-reprint-request-id="${esc(entry.id || '')}" data-delete-reprint-admin="false">${t('processed.button.cancel-request')}</button>`;
          })() : ''}
          ${options.isAdmin ? `<button class="btn-sm admin-only" type="button" data-delete-reprint-request-id="${esc(entry.id || '')}" data-delete-reprint-admin="true">${t('btn.delete')}</button>` : ''}
        </div>
      </div>`;
    }).join('');
    const unmatchedHtml = matched.unmatchedRecords.length ? `<details class="pp-reprint-tech-details">
      <summary>${t('processed.reprint.unmatched-records')}</summary>
      <div class="pp-reprint-tech-grid">
        ${matched.unmatchedRecords.map((record) => {
          const fileNames = getRecordPrintFiles(record)
            .map((file) => fileNameFromPath(file && (file.printFilePath || file.print_file_path || '')))
            .filter(Boolean)
            .join(', ');
          const parts = [
            record.xmlFileName || '',
            getRecordProcessedAt(record) ? formatPipelineDateTime(getRecordProcessedAt(record)) : '',
            fileNames,
          ].filter(Boolean);
          return `<div class="pp-reprint-tech-item"><span>${t('processed.reprint.unmatched-record')}</span><strong>${esc(parts.join(' · ') || '-')}</strong></div>`;
        }).join('')}
      </div>
    </details>` : '';
    return `<div class="pp-reprint-history">${historyHtml}${unmatchedHtml}</div>`;
  }

  function renderPdfFiles(row, options, allHistory) {
    const esc = options.esc;
    if (!row.hasDetail) {
      return `<div class="pp-file-block"><button class="btn-sm" type="button" data-load-order-detail-id="${esc(row.processedOrderId || row.id || '')}" data-load-order-detail-number="${esc(row.orderName || '')}">${t('processed.button.load-details')}</button></div>`;
    }
    const files = normalizePrintFiles(row);
    if (!files.length) return '<div class="pp-file-block"><span class="pp-file-name">-</span></div>';
    return files.map((file, index) => {
      const path = file.printFilePath || '';
      const label = fileNameFromPath(path) || `PDF ${index + 1}`;
      const orderId = row.processedOrderId || row.id;
      const pdfUrl = typeof options.toPdfHref === 'function'
        ? options.toPdfHref({ orderId, orderName: row.orderName || row.processedOrderName || '', fileIndex: index })
        : '';
      const actionState = getReprintActionState(orderId, path, options);
      const pending = actionState.state === 'pending' || actionState.state === 'resolving';
      const resolved = actionState.state === 'resolved';
      const errored = actionState.state === 'error';
      const reprintDisabled = !orderId || !path;
      const displayOrderName = getPrimaryOrderLabel(row);
      const marker = getFileReprintMarker(row, file, options, allHistory);
      return `<div class="pp-file-block">
        <div class="pp-file-row">
          <div>
            <div class="pp-file-title">${esc(label)}</div>
            <div class="pp-file-meta">${t('processed.label.size')}: ${esc(formatFileSize(file.pageSize))}</div>
          </div>
          ${marker ? `<span class="pp-pipeline-badge ${marker.className}">${esc(marker.label)}</span>` : ''}
          ${pending && actionState.state === 'resolving' ? `<span class="pp-pipeline-badge processed">${t('processed.status.resolving')}</span>` : ''}
          ${resolved ? `<span class="pp-pipeline-badge done">${t('processed.reprint.status.done')}</span>` : ''}
          ${errored ? `<span class="pp-pipeline-badge error">${t('processed.status.resolve-failed')}</span>` : ''}
        </div>
        <div class="pp-file-actions">
          <button class="btn-sm" type="button" data-open-pdf-url="${esc(pdfUrl)}" ${pdfUrl ? '' : 'disabled'}>${t('processed.button.open-pdf')}</button>
          <button class="btn-sm" type="button" data-copy-path="${esc(path)}">${t('processed.button.copy-path')}</button>
          ${actionState.state === 'idle' && !(marker && marker.active) ? `<button class="btn-sm" type="button" data-reprint-order-id="${esc(orderId || '')}" data-reprint-order-name="${esc(displayOrderName || row.orderName || '')}" data-print-file-path="${esc(path)}" data-print-file-label="${esc(label)}" ${reprintDisabled ? 'disabled' : ''}>${t('processed.button.request-reprint')}</button>` : ''}
        </div>
      </div>`;
    }).join('');
  }

  function renderFullReprintAction(row, options) {
    const esc = options.esc;
    if (!row.hasDetail) {
      return '';
    }
    const rowState = getRowReprintState(row, options);
    if (rowState.state !== 'idle') {
      return '';
    }
    const orderId = row.processedOrderId || row.id;
    const displayOrderName = getPrimaryOrderLabel(row);
    return `<button class="btn-sm" type="button" data-reprint-order-id="${esc(orderId || '')}" data-reprint-order-name="${esc(displayOrderName || row.orderName || '')}" data-print-file-path="" data-print-file-label="${t('processed.full-order')}" ${orderId ? '' : 'disabled'}>${t('processed.button.full-reprint')}</button>`;
  }

  function renderAdminOrderActions(row, options) {
    if (!options.isAdmin) return '';
    const esc = options.esc;
    const processedOrderId = row.processedOrderId || row.id || '';
    const orderName = getPrimaryOrderLabel(row) || row.orderName || row.processedOrderName || '';
    const cancelled = row.pipelineStatus === 'cancelled' || row.adminStatus === 'cancelled';
    return `<div class="pp-admin-order-actions admin-only">
      ${cancelled ? '' : `<button class="btn-sm" type="button" data-admin-order-action="cancel_order" data-admin-order-processed-id="${esc(processedOrderId)}" data-admin-order-external-id="${esc(row.externalOrderId || '')}" data-admin-order-number="${esc(orderName)}">${t('processed.button.cancel-order')}</button>`}
      <button class="btn-sm danger" type="button" data-admin-order-action="delete_order" data-admin-order-processed-id="${esc(processedOrderId)}" data-admin-order-external-id="${esc(row.externalOrderId || '')}" data-admin-order-number="${esc(orderName)}">${t('processed.button.delete-order')}</button>
    </div>`;
  }

  function renderOrders(rows, options) {
    const esc = options.esc;
    const summary = renderPipelineStats(options.stats, options);
    const orderedRows = Array.isArray(rows) ? rows.slice() : [];
    if (!orderedRows.length) {
      return `${summary}<div class="empty-state"><div class="empty-state-icon">-</div><p>${t('processed.empty')}</p></div>`;
    }

    return `<div class="pp-processed-list">
      ${summary}
      ${orderedRows.map((row) => {
        const attentionState = getAttentionState(row);
        const reprintState = getRowReprintState(row, options);
        const primaryLabel = getPrimaryOrderLabel(row);
        const secondaryLabels = getSecondaryOrderLabels(row, primaryLabel);
        const cardClass = [
          attentionState ? `pp-processed-card--${attentionState}` : '',
          reprintState.state && reprintState.state !== 'idle' ? `pp-processed-card--${reprintState.state}` : '',
          reprintState.state && reprintState.state !== 'idle' ? `pipeline-card--${reprintState.state}` : '',
        ].filter(Boolean).map((value) => ` ${value}`).join('');
        const attentionNote = attentionState === 'unprocessed'
          ? t('processed.status.unprocessed')
          : attentionState === 'reprint'
            ? ''
            : attentionState === 'orphan'
              ? t('processed.status.no-api-match')
              : '';
        const rowHistory = getAllRowHistory(row, options);
        const matchedHistory = matchReprintHistory(rowHistory, row && row.reprintRecords);
        const printedOutMeta = formatPrintedOutMeta(row);
        const cardStatus = getOrderCardStatus(row, options, matchedHistory.entries);
        return `
      <article class="pp-processed-card${cardClass}">
        <section class="pp-card-section pp-card-summary">
          <div class="pp-processed-head">
          <div>
            <div class="pp-order-main">${esc(primaryLabel || '-')}</div>
            <div class="pp-order-sub">${esc(secondaryLabels.join(' · '))}</div>
            ${renderOrderHeaderChips(row, matchedHistory.entries, esc)}
          </div>
          <div class="pp-order-state">
            <span>${t('processed.card.current-status')}</span>
            <strong class="pp-pipeline-badge ${cardStatus.badgeClass}">${esc(cardStatus.label)}</strong>
          </div>
          </div>
          ${attentionNote ? `<div class="pp-attention-note">${esc(attentionNote)}</div>` : ''}
          ${renderAdminOrderActions(row, options)}
          <div class="pp-processed-operational-meta">
          <span><strong>${t('processed.card.requested-at')}:</strong> ${esc(formatPipelineDateTime(row.receivedAt || row.apiSeenAt))}</span>
          <span><strong>${t('processed.card.processed-at')}:</strong> ${esc(formatPipelineDateTime(row.processedAt || row.queuedDateTime))}</span>
          <span><strong>${t('processed.label.size')}:</strong> ${esc(getPageSizes(row))}</span>
          ${printedOutMeta ? `<span><strong>${t('processed.label.printed-out')}:</strong> ${esc(printedOutMeta)}</span>` : ''}
          </div>
        </section>
        <section class="pp-card-section pp-action-needed">
          ${renderActionNeeded(row, options)}
          <div class="pp-file-actions pp-full-reprint-actions">
          ${renderFullReprintAction(row, options)}
          </div>
        </section>
        <section class="pp-card-section pp-pdf-section">
          <div class="pp-section-label">PDF</div>
          ${renderPdfFiles(row, options, matchedHistory.entries)}
        </section>
        <section class="pp-card-section">
          <div class="pp-section-label">${t('processed.section.reprint-history')}</div>
          ${renderReprintHistory(row, rowHistory, esc, options) || `<div class="pp-order-sub">${t('processed.no-reprint-xml')}</div>`}
        </section>
        <details class="pp-card-section pp-tech-details">
          <summary>${t('processed.section.technical-details')}</summary>
          <div class="pp-reprint-tech-grid">
            <div class="pp-reprint-tech-item"><span>${t('processed.label.workflow')}</span><strong>${esc(row.workflowName || row.printerName || '-')}</strong></div>
            <div class="pp-reprint-tech-item"><span>${t('processed.label.type')}</span><strong>${esc(row.orderType || '-')}</strong></div>
            <div class="pp-reprint-tech-item"><span>${t('processed.label.submittool-processed')}</span><strong>${esc(formatPipelineDateTime(row.processedAt || row.queuedDateTime))}</strong></div>
            <div class="pp-reprint-tech-item"><span>${t('processed.label.received-at')}</span><strong>${esc(formatPipelineDateTime(row.receivedAt || row.apiSeenAt))}</strong></div>
          </div>
          <div class="pp-xml-source">
            <span>${esc(row.xmlFileName || '-')}</span>
            ${row.sourceXmlPath ? `<button class="btn-sm" type="button" data-copy-path="${esc(row.sourceXmlPath || '')}">${t('processed.button.copy-xml-path')}</button>` : ''}
          </div>
          ${row.sourceXmlPath ? `<div class="pp-file-path">${esc(row.sourceXmlPath)}</div>` : ''}
        </details>
      </article>
    `; }).join('')}</div>`;
  }

  function renderError(message, esc) {
    return `<div class="empty-state"><div class="empty-state-icon">⚠</div><p>${t('processed.error.load')}</p><div class="table-empty-note">${esc(message)}</div><button class="btn-sm" type="button" data-pp-retry="true">${t('btn.refresh')}</button></div>`;
  }

  window.PrintGuardOrderPipelineRender = {
    fileNameFromPath,
    getReprintKey,
    renderError,
    renderOrders,
  };
})();
