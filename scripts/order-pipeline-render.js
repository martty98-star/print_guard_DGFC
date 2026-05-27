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

  function xmlStatusClass(status) {
    const normalized = String(status || '').toLowerCase();
    if (normalized === 'missing') return 'missing';
    if (normalized === 'expected') return 'reprint';
    return 'received';
  }

  function isReprintRow(row) {
    return row && String(row.orderType || '').toUpperCase() === 'R';
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
    if (row.receivedAt || row.apiSeenAt || row.externalOrderId) {
      badges.push(`<span class="pp-pipeline-badge received">${t('processed.badge.received')}</span>`);
    }
    if (row.processedOrderId || row.queuedDateTime || row.processedAt) {
      badges.push(`<span class="pp-pipeline-badge processed">${t('processed.badge.processed')}</span>`);
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

  function renderActionNeeded(row, options) {
    if (row.pipelineStatus === 'cancelled' || row.adminStatus === 'cancelled') {
      return `<span class="pp-pipeline-badge cancelled">${t('processed.badge.cancelled')}</span><span>${options.esc(row.adminNote || t('processed.action.cancelled-text'))}</span>`;
    }
    const state = getRowReprintState(row, options);
    if (state.state === 'resolving' || state.state === 'resolved' || state.state === 'error') {
      return renderReprintStateBlock(row, state, options);
    }
    if (state.state === 'pending' || row.reprintPending) {
      return `<span class="pp-pipeline-badge reprint">${t('processed.action.reprint-pending')}</span><span>${t('processed.action.reprint-pending-text')}</span>`;
    }
    const xmlStatus = getXmlStatus(row);
    if (xmlStatus) return `<span class="pp-pipeline-badge ${xmlStatusClass(xmlStatus)}">${xmlStatus}</span><span>${t('processed.action.none-text')}</span>`;
    return `<span class="pp-pipeline-badge done">${t('processed.action.none')}</span><span>${t('processed.action.none-text')}</span>`;
  }

  function getReprintKey(orderId, printFilePath) {
    return `${orderId || ''}::${printFilePath || '__FULL_REPRINT__'}`;
  }

  function getFileHistory(orderId, printFilePath, options) {
    const history = options.reprintHistoryByKey && options.reprintHistoryByKey.get(getReprintKey(orderId, printFilePath));
    return Array.isArray(history) ? history : [];
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
        <span class="pp-pipeline-badge reprint">${t('processed.status.resolving')}</span>
        <span>${esc(actionState.message || t('processed.action.reprint-resolving-text'))}</span>
      </div>`;
    }
    if (actionState.state === 'resolved') {
      return `<div class="pp-reprint-action-state resolved">
        <span class="pp-pipeline-badge done">${t('processed.status.resolved')}</span>
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
        <span class="pp-pipeline-badge reprint">${t('processed.action.reprint-pending')}</span>
        <span>${t('processed.action.reprint-pending-text')}</span>
      </div>`;
    }
    return '';
  }

  function renderReprintHistory(entries, esc, options) {
    if (!entries.length) return '';
    return `<div class="pp-reprint-history">
      ${entries.map((entry) => `<div class="pp-reprint-history-entry">
        <div class="pp-reprint-history-top">
          <span class="pp-pipeline-badge ${reprintStatusClass(entry.status)}">${esc(entry.status || 'pending')}</span>
          <strong>${esc(entry.reason || '-')}</strong>
        </div>
        <div class="pp-reprint-history-meta">
          <span>${t('processed.history.by')}: ${esc(entry.requestedBy || '-')}</span>
          <span>${t('processed.history.requested')}: ${esc(formatPipelineDateTime(entry.requestedAt))}</span>
          ${entry.confirmedAt ? `<span>${t('processed.history.confirmed')}: ${esc(formatPipelineDateTime(entry.confirmedAt))}</span>` : ''}
        </div>
        ${entry.note ? `<div class="pp-reprint-history-note">${esc(entry.note)}</div>` : ''}
        <div class="pp-file-actions">
          ${entry.status === 'pending' ? (() => {
            const actionState = getReprintActionState(entry.orderId, entry.printFilePath, options);
            const buttonLabel = actionState.state === 'resolving'
              ? t('processed.status.resolving')
              : t('processed.button.mark-reprinted');
            const buttonDisabled = actionState.state === 'resolving' ? 'disabled' : '';
            return `<button class="btn-sm" type="button" data-resolve-reprint-order-id="${esc(entry.orderId || '')}" data-resolve-print-file-path="${esc(entry.printFilePath || '')}" ${buttonDisabled}>${buttonLabel}</button><button class="btn-sm" type="button" data-delete-reprint-request-id="${esc(entry.id || '')}" data-delete-reprint-admin="false">${t('processed.button.cancel-request')}</button>`;
          })() : ''}
          ${options.isAdmin ? `<button class="btn-sm admin-only" type="button" data-delete-reprint-request-id="${esc(entry.id || '')}" data-delete-reprint-admin="true">${t('btn.delete')}</button>` : ''}
        </div>
      </div>`).join('')}
    </div>`;
  }

  function renderPdfFiles(row, options) {
    const esc = options.esc;
    if (!row.hasDetail) {
      return `<div class="pp-file-block"><button class="btn-sm" type="button" data-load-order-detail-id="${esc(row.processedOrderId || row.id || '')}" data-load-order-detail-number="${esc(row.orderName || '')}">${t('processed.button.load-details')}</button></div>`;
    }
    const files = normalizePrintFiles(row);
    if (!files.length) return '<div class="pp-file-block"><span class="pp-file-name">-</span></div>';
    return files.map((file, index) => {
      const path = file.printFilePath || '';
      const label = fileNameFromPath(path) || `PDF ${index + 1}`;
      const href = options.toFileHref(path);
      const orderId = row.processedOrderId || row.id;
      const history = getFileHistory(orderId, path, options);
      const actionState = getReprintActionState(orderId, path, options);
      const pending = actionState.state === 'pending' || actionState.state === 'resolving';
      const resolved = actionState.state === 'resolved';
      const errored = actionState.state === 'error';
      const reprintDisabled = !orderId || !path;
      const displayOrderName = getPrimaryOrderLabel(row);
      return `<div class="pp-file-block">
        <div class="pp-file-row">
          <div>
            <div class="pp-file-title">${esc(label)}</div>
            <div class="pp-file-path">${esc(path || '-')}</div>
          </div>
          ${pending ? `<span class="pp-pipeline-badge reprint">${t(actionState.state === 'resolving' ? 'processed.status.resolving' : 'processed.action.reprint-pending')}</span>` : ''}
          ${resolved ? `<span class="pp-pipeline-badge done">${t('processed.status.resolved')}</span>` : ''}
          ${errored ? `<span class="pp-pipeline-badge error">${t('processed.status.resolve-failed')}</span>` : ''}
        </div>
        <div class="pp-file-actions">
          <button class="btn-sm" type="button" data-open-pdf-path="${esc(path)}" data-open-pdf-href="${esc(href)}">${t('processed.button.open-pdf')}</button>
          <button class="btn-sm" type="button" data-copy-path="${esc(path)}">${t('processed.button.copy-path')}</button>
          ${actionState.state === 'idle' ? `<button class="btn-sm" type="button" data-reprint-order-id="${esc(orderId || '')}" data-reprint-order-name="${esc(displayOrderName || row.orderName || '')}" data-print-file-path="${esc(path)}" data-print-file-label="${esc(label)}" ${reprintDisabled ? 'disabled' : ''}>${t('processed.button.request-reprint')}</button>` : ''}
        </div>
        ${renderReprintHistory(history, esc, options)}
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

  function renderProcessedReprintRecords(row, esc) {
    if (!row.hasDetail && row.reprintRecordCount > 0) {
      return `<div class="pp-reprint-records"><div class="pp-section-label">${t('processed.section.processed-reprint-xml')}: ${esc(row.reprintRecordCount)}</div></div>`;
    }
    const records = Array.isArray(row.reprintRecords) ? row.reprintRecords : [];
    if (!records.length) return '';
    return `<div class="pp-reprint-records">
      <div class="pp-section-label">${t('processed.section.processed-reprint-xml')}: ${esc(row.reprintRecordCount || records.length)}</div>
      ${records.map((record) => {
        const files = Array.isArray(record.printFiles) ? record.printFiles : [];
        const fileNames = files
          .map((file) => fileNameFromPath(file.printFilePath || file.print_file_path || ''))
          .filter(Boolean)
          .join(', ');
        return `<div class="pp-reprint-record">
          <div class="pp-reprint-history-top">
            ${isReprintRow(record) ? '<span class="pp-pipeline-badge reprint">RE</span>' : ''}
            <span class="pp-pipeline-badge ${reprintStatusClass(record.status)}">${esc(record.status || '-')}</span>
            ${record.isFullReprint ? '<span class="pp-pipeline-badge reprint">FULL</span>' : ''}
            <strong>${esc(record.orderName || record.xmlFileName || t('processed.reprint'))}</strong>
          </div>
          <div class="pp-reprint-history-meta">
            <span>${t('processed.history.processed')}: ${esc(formatPipelineDateTime(record.processedAt || record.queuedDateTime))}</span>
            ${record.xmlFileName ? `<span>XML: ${esc(record.xmlFileName)}</span>` : ''}
            ${fileNames ? `<span>PDF: ${esc(fileNames)}</span>` : ''}
          </div>
          ${record.sourceXmlPath ? `<div class="pp-reprint-history-note">${esc(record.sourceXmlPath)}</div>` : ''}
        </div>`;
      }).join('')}
    </div>`;
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
            ? t('processed.status.reprint-pending')
            : attentionState === 'orphan'
              ? t('processed.status.no-api-match')
              : '';
        return `
      <article class="pp-processed-card${cardClass}">
        <section class="pp-card-section pp-card-summary">
          <div class="pp-processed-head">
          <div>
            <div class="pp-order-main">${esc(primaryLabel || '-')}</div>
            <div class="pp-order-sub">${esc(secondaryLabels.join(' · '))}</div>
          </div>
          <div class="pp-processed-time">
            <div>${t('processed.label.submittool-processed')}: ${esc(formatPipelineDateTime(row.processedAt || row.queuedDateTime))}</div>
            <div>${t('processed.label.received-at')}: ${esc(formatPipelineDateTime(row.receivedAt || row.apiSeenAt))}</div>
          </div>
          </div>
          <div class="pp-pipeline-badges">${renderPipelineBadges(row)}</div>
          ${attentionNote ? `<div class="pp-attention-note">${esc(attentionNote)}</div>` : ''}
          ${renderAdminOrderActions(row, options)}
          <div class="pp-processed-meta">
          <span><strong>${t('processed.label.workflow')}:</strong> ${esc(row.workflowName || row.printerName || '-')}</span>
          <span><strong>${t('processed.label.type')}:</strong> ${esc(row.orderType || '-')}</span>
          <span><strong>${t('processed.label.size')}:</strong> ${esc(getPageSizes(row))}</span>
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
          ${renderPdfFiles(row, options)}
        </section>
        <section class="pp-card-section">
          ${renderProcessedReprintRecords(row, esc) || `<div class="pp-section-label">${t('processed.section.reprint-history')}</div><div class="pp-order-sub">${t('processed.no-reprint-xml')}</div>`}
        </section>
        <details class="pp-card-section pp-tech-details">
          <summary>${t('processed.section.technical-details')}</summary>
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
