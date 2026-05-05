'use strict';

(() => {
  const MISSING_PROCESSED_THRESHOLD_MINUTES = 30;

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

  function isReprintRow(row) {
    return row && String(row.orderType || '').toUpperCase() === 'R';
  }

  function renderPipelineBadges(row) {
    const badges = [];
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
    if (isMissingProcessedXml(row)) {
      badges.push(`<span class="pp-pipeline-badge missing">${t('processed.badge.missing-xml')}</span>`);
    }
    if (row.pipelineStatus === 'processed_without_received') {
      badges.push(`<span class="pp-pipeline-badge orphan">${t('processed.badge.no-api-match')}</span>`);
    }
    return badges.join('');
  }

  function renderActionNeeded(row) {
    if (row.reprintPending) return `<span class="pp-pipeline-badge reprint">${t('processed.action.reprint-pending')}</span><span>${t('processed.action.reprint-pending-text')}</span>`;
    if (isMissingProcessedXml(row)) return `<span class="pp-pipeline-badge missing">${t('processed.action.needed')}</span><span>${t('processed.action.missing-text')}</span>`;
    return `<span class="pp-pipeline-badge done">${t('processed.action.none')}</span><span>${t('processed.action.none-text')}</span>`;
  }

  function getReprintKey(orderId, printFilePath) {
    return `${orderId || ''}::${printFilePath || '__FULL_REPRINT__'}`;
  }

  function getFileHistory(orderId, printFilePath, options) {
    const history = options.reprintHistoryByKey && options.reprintHistoryByKey.get(getReprintKey(orderId, printFilePath));
    return Array.isArray(history) ? history : [];
  }

  function reprintStatusClass(status) {
    const normalized = String(status || '').toLowerCase();
    if (normalized === 'done' || normalized === 'completed' || normalized === 'resolved') return 'done';
    return 'reprint';
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
          ${entry.status === 'pending' ? `<button class="btn-sm" type="button" data-resolve-reprint-order-id="${esc(entry.orderId || '')}" data-resolve-print-file-path="${esc(entry.printFilePath || '')}">${t('processed.button.mark-reprinted')}</button><button class="btn-sm" type="button" data-delete-reprint-request-id="${esc(entry.id || '')}" data-delete-reprint-admin="false">${t('processed.button.cancel-request')}</button>` : ''}
          ${options.isAdmin ? `<button class="btn-sm admin-only" type="button" data-delete-reprint-request-id="${esc(entry.id || '')}" data-delete-reprint-admin="true">${t('btn.delete')}</button>` : ''}
        </div>
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
      const pendingEntry = history.find((entry) => entry.status === 'pending');
      const pendingKey = getReprintKey(orderId, path);
      const pending = Boolean(pendingEntry) || options.reprintPendingKeys.has(pendingKey);
      const reprintDisabled = !orderId || !path;
      return `<div class="pp-file-block">
        <div class="pp-file-row">
          <div>
            <div class="pp-file-title">${esc(label)}</div>
            <div class="pp-file-path">${esc(path || '-')}</div>
          </div>
          ${pending ? `<span class="pp-pipeline-badge reprint">${t('processed.action.reprint-pending')}</span>` : ''}
        </div>
        <div class="pp-file-actions">
          <button class="btn-sm" type="button" data-open-pdf-path="${esc(path)}" data-open-pdf-href="${esc(href)}">${t('processed.button.open-pdf')}</button>
          <button class="btn-sm" type="button" data-copy-path="${esc(path)}">${t('processed.button.copy-path')}</button>
          ${pending ? '' : `<button class="btn-sm" type="button" data-reprint-order-id="${esc(orderId || '')}" data-reprint-order-name="${esc(row.orderName || '')}" data-print-file-path="${esc(path)}" data-print-file-label="${esc(label)}" ${reprintDisabled ? 'disabled' : ''}>${t('processed.button.request-reprint')}</button>`}
        </div>
        ${renderReprintHistory(history, esc, options)}
      </div>`;
    }).join('');
  }

  function renderFullReprintAction(row, options) {
    const esc = options.esc;
    const orderId = row.processedOrderId || row.id;
    const history = getFileHistory(orderId, '', options);
    const pendingKey = getReprintKey(orderId, '');
    const pending = history.some((entry) => entry.status === 'pending') || options.reprintPendingKeys.has(pendingKey);
    if (pending) {
      return `<button class="btn-sm" type="button" data-resolve-reprint-order-id="${esc(orderId || '')}" data-resolve-print-file-path="">${t('processed.button.mark-full-reprinted')}</button>`;
    }
    return `<button class="btn-sm" type="button" data-reprint-order-id="${esc(orderId || '')}" data-reprint-order-name="${esc(row.orderName || '')}" data-print-file-path="" data-print-file-label="${t('processed.full-order')}" ${orderId ? '' : 'disabled'}>${t('processed.button.full-reprint')}</button>`;
  }

  function renderProcessedReprintRecords(row, esc) {
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

  function renderOrders(rows, options) {
    const esc = options.esc;
    if (!rows.length) {
      return `<div class="empty-state"><div class="empty-state-icon">-</div><p>${t('processed.empty')}</p></div>`;
    }

    return `<div class="pp-processed-list">${rows.map((row) => `
      <article class="pp-processed-card">
        <section class="pp-card-section pp-card-summary">
          <div class="pp-processed-head">
          <div>
            <div class="pp-order-main">${esc(row.orderName || '-')}</div>
            <div class="pp-order-sub">${esc([row.externalOrderId, row.customerOrderId].filter(Boolean).join(' · '))}</div>
          </div>
          <div class="pp-processed-time">
            <div>${t('processed.label.submittool-processed')}: ${esc(formatPipelineDateTime(row.processedAt || row.queuedDateTime))}</div>
            <div>${t('processed.label.received-at')}: ${esc(formatPipelineDateTime(row.receivedAt || row.apiSeenAt))}</div>
          </div>
          </div>
          <div class="pp-pipeline-badges">${renderPipelineBadges(row)}</div>
          <div class="pp-processed-meta">
          <span><strong>${t('processed.label.workflow')}:</strong> ${esc(row.workflowName || row.printerName || '-')}</span>
          <span><strong>${t('processed.label.type')}:</strong> ${esc(row.orderType || '-')}</span>
          <span><strong>${t('processed.label.size')}:</strong> ${esc(getPageSizes(row))}</span>
          </div>
        </section>
        <section class="pp-card-section pp-action-needed">
          ${renderActionNeeded(row)}
          ${isMissingProcessedXml(row) ? `<div class="pp-missing-warning">${t('processed.warning.missing-xml')}</div>` : ''}
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
    `).join('')}</div>`;
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
