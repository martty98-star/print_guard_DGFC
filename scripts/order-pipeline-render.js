'use strict';

(() => {
  const MISSING_PROCESSED_THRESHOLD_MINUTES = 30;

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

  function isMissingProcessedXml(row) {
    return row && row.pipelineStatus === 'received_only' && getPipelineAgeMinutes(row) >= MISSING_PROCESSED_THRESHOLD_MINUTES;
  }

  function renderPipelineBadges(row) {
    const badges = [];
    if (row.receivedAt || row.apiSeenAt || row.externalOrderId) {
      badges.push('<span class="pp-pipeline-badge received">RECEIVED</span>');
    }
    if (row.processedOrderId || row.queuedDateTime || row.processedAt) {
      badges.push('<span class="pp-pipeline-badge processed">PROCESSED</span>');
    }
    if (Array.isArray(row.printFiles) && row.printFiles.length) {
      badges.push('<span class="pp-pipeline-badge pdf">PDF</span>');
    }
    if (row.reprintPending || row.pipelineStatus === 'reprint_pending') {
      badges.push('<span class="pp-pipeline-badge reprint">REPRINT PENDING</span>');
    } else if (row.reprintRequestCount > 0) {
      badges.push('<span class="pp-pipeline-badge reprint">REPRINT REQUESTED</span>');
    }
    if (isMissingProcessedXml(row)) {
      badges.push('<span class="pp-pipeline-badge missing">Missing processed XML</span>');
    }
    if (row.pipelineStatus === 'processed_without_received') {
      badges.push('<span class="pp-pipeline-badge orphan">NO API MATCH</span>');
    }
    return badges.join('');
  }

  function getReprintKey(orderId, printFilePath) {
    return `${orderId || ''}::${printFilePath || ''}`;
  }

  function getFileHistory(orderId, printFilePath, options) {
    const history = options.reprintHistoryByKey && options.reprintHistoryByKey.get(getReprintKey(orderId, printFilePath));
    return Array.isArray(history) ? history : [];
  }

  function renderReprintHistory(entries, esc) {
    if (!entries.length) return '';
    return `<div class="pp-reprint-history">
      <div class="pp-section-label">Reprint history</div>
      ${entries.map((entry) => `<div class="pp-reprint-history-entry">
        <span class="pp-pipeline-badge reprint">${esc(entry.status || 'pending')}</span>
        <span>${esc(entry.reason || '-')}</span>
        <span>${esc(entry.requestedBy || '-')}</span>
        <span>Requested: ${esc(formatPipelineDateTime(entry.requestedAt))}</span>
        ${entry.confirmedAt ? `<span>Confirmed: ${esc(formatPipelineDateTime(entry.confirmedAt))}</span>` : ''}
        ${entry.note ? `<small>${esc(entry.note)}</small>` : ''}
      </div>`).join('')}
    </div>`;
  }

  function renderPdfFiles(row, options) {
    const esc = options.esc;
    const files = normalizePrintFiles(row);
    if (!files.length) return '<div class="pp-file-block"><span class="pp-file-name">-</span></div>';
    return files.map((file, index) => {
      const path = file.printFilePath || '';
      const label = fileNameFromPath(path) || `PDF ${index + 1}`;
      const href = options.toFileHref(path);
      const orderId = row.processedOrderId || row.id;
      const history = getFileHistory(orderId, path, options);
      const pendingKey = getReprintKey(orderId, path);
      const pending = history.some((entry) => entry.status === 'pending') || options.reprintPendingKeys.has(pendingKey);
      const reprintDisabled = !orderId || !path;
      const reprintAction = pending
        ? `<button class="btn-sm" type="button" data-resolve-reprint-order-id="${esc(orderId || '')}" data-resolve-print-file-path="${esc(path)}">Mark reprinted</button>`
        : `<button class="btn-sm" type="button" data-reprint-order-id="${esc(orderId || '')}" data-reprint-order-name="${esc(row.orderName || '')}" data-print-file-path="${esc(path)}" data-print-file-label="${esc(label)}" ${reprintDisabled ? 'disabled' : ''}>Reprint request</button>`;
      return `<div class="pp-file-block">
        <div class="pp-file-title">${esc(label)}</div>
        <div class="pp-file-path">${esc(path || '-')}</div>
        <div class="pp-file-actions">
          <button class="btn-sm" type="button" data-open-pdf-path="${esc(path)}" data-open-pdf-href="${esc(href)}">Open PDF</button>
          <button class="btn-sm" type="button" data-copy-path="${esc(path)}">Copy path</button>
          ${pending ? '<button class="btn-sm" type="button" disabled>Reprint pending</button>' : ''}
          ${reprintAction}
        </div>
        ${renderReprintHistory(history, esc)}
      </div>`;
    }).join('');
  }

  function renderOrders(rows, options) {
    const esc = options.esc;
    if (!rows.length) {
      return `<div class="empty-state"><div class="empty-state-icon">-</div><p>No orders match the current filters.</p></div>`;
    }

    return `<div class="pp-processed-list">${rows.map((row) => `
      <article class="pp-processed-card">
        <div class="pp-processed-head">
          <div>
            <div class="pp-order-main">${esc(row.orderName || '-')}</div>
            <div class="pp-order-sub">${esc([row.externalOrderId, row.customerOrderId, row.xmlFileName].filter(Boolean).join(' · '))}</div>
          </div>
          <div class="pp-processed-time">
            <div>SubmitTool processed: ${esc(formatPipelineDateTime(row.processedAt || row.queuedDateTime))}</div>
            <div>Received at: ${esc(formatPipelineDateTime(row.receivedAt || row.apiSeenAt))}</div>
          </div>
        </div>
        <div class="pp-pipeline-badges">${renderPipelineBadges(row)}</div>
        ${isMissingProcessedXml(row) ? `<div class="pp-missing-warning">Missing processed XML after ${MISSING_PROCESSED_THRESHOLD_MINUTES} minutes.</div>` : ''}
        <div class="pp-processed-meta">
          <span><strong>Workflow:</strong> ${esc(row.workflowName || row.printerName || '-')}</span>
          <span><strong>Type:</strong> ${esc(row.orderType || '-')}</span>
          <span><strong>Size:</strong> ${esc(getPageSizes(row))}</span>
        </div>
        <div class="pp-pdf-section">
          <div class="pp-section-label">PDF</div>
          ${renderPdfFiles(row, options)}
        </div>
        ${row.sourceXmlPath ? `<div class="pp-xml-source">
          <span>${esc(fileNameFromPath(row.sourceXmlPath || ''))}</span>
          <button class="btn-sm" type="button" data-copy-path="${esc(row.sourceXmlPath || '')}">Copy XML path</button>
        </div>` : ''}
      </article>
    `).join('')}</div>`;
  }

  function renderError(message, esc) {
    return `<div class="empty-state"><div class="empty-state-icon">⚠</div><p>Processed orders could not be loaded.</p><div class="table-empty-note">${esc(message)}</div><button class="btn-sm" type="button" data-pp-retry="true">Refresh</button></div>`;
  }

  window.PrintGuardOrderPipelineRender = {
    fileNameFromPath,
    getReprintKey,
    renderError,
    renderOrders,
  };
})();
