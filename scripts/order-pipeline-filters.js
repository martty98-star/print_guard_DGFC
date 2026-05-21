'use strict';

(() => {
  function cleanString(value) {
    if (value == null) return '';
    return String(value).trim();
  }

  function normalizeSearchTerm(value) {
    return cleanString(value)
      .toLowerCase()
      .replace(/[\s_-]+/g, '')
      .replace(/[\\/]+/g, '/');
  }

  function collectSearchParts(row) {
    if (!row || typeof row !== 'object') return [];

    const parts = [
      row.orderName,
      row.externalOrderId,
      row.customerOrderId,
      row.id,
      row.processedOrderId,
      row.processedOrderName,
      row.xmlFileName,
      row.sourceXmlPath,
      row.workflowName,
      row.orderType,
      row.pipelineStatus,
      row.latestReprintStatus,
      row.receivedAt,
      row.apiSeenAt,
      row.processedAt,
      row.queuedDateTime,
      row.sourceMonth,
    ];

    for (const file of Array.isArray(row.printFiles) ? row.printFiles : []) {
      parts.push(file && file.printFilePath);
      parts.push(file && file.pageSize);
      parts.push(file && file.copies);
    }

    for (const record of Array.isArray(row.reprintRecords) ? row.reprintRecords : []) {
      parts.push(record && record.orderName);
      parts.push(record && record.xmlFileName);
      parts.push(record && record.status);
      parts.push(record && record.reason);
      parts.push(record && record.note);
      parts.push(record && record.sourceXmlPath);
      parts.push(record && record.printFilePath);
      for (const file of Array.isArray(record.printFiles) ? record.printFiles : []) {
        parts.push(file && file.printFilePath);
        parts.push(file && file.pageSize);
        parts.push(file && file.copies);
      }
    }

    return parts.filter(Boolean).map(String);
  }

  function getFiltersFromState(S) {
    return {
      limit: S.postPurchaseLimit || '50',
      offset: String(S.postPurchaseOffset || 0),
      datePreset: S.postPurchaseDatePreset || 'this_month',
      from: S.postPurchaseDateFrom || '',
      to: S.postPurchaseDateTo || '',
      status: S.postPurchaseStatus || 'all',
      reprint: S.postPurchaseReprint || 'all',
      month: S.postPurchaseMonth || '',
      q: getSearchFromState(S),
    };
  }

  function getSearchFromState(S) {
    return cleanString(S && S.postPurchaseSearch);
  }

  function toQueryParams(filters) {
    const params = new URLSearchParams();
    params.set('limit', filters.limit || '50');
    params.set('offset', filters.offset || '0');
    params.set('datePreset', filters.datePreset || 'this_month');
    if (filters.status && filters.status !== 'all') params.set('status', filters.status);
    params.set('reprint', filters.reprint || 'all');
    if (filters.q) params.set('q', filters.q);
    if (filters.includeStats) params.set('includeStats', filters.includeStats);
    if (filters.month) params.set('month', filters.month);
    if ((filters.datePreset || '') === 'custom') {
      if (filters.from) params.set('from', filters.from);
      if (filters.to) params.set('to', filters.to);
    }
    return params;
  }

  function filterRows(rows, search) {
    const needle = normalizeSearchTerm(search);
    if (!needle) return Array.isArray(rows) ? rows : [];

    return (Array.isArray(rows) ? rows : []).filter((row) => {
      const haystack = normalizeSearchTerm(collectSearchParts(row).join(' '));
      return haystack.includes(needle);
    });
  }

  window.PrintGuardOrderPipelineFilters = {
    filterRows,
    getSearchFromState,
    getFiltersFromState,
    toQueryParams,
  };
})();
