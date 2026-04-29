'use strict';

(() => {
  function getFiltersFromState(S) {
    return {
      limit: '500',
      datePreset: S.postPurchaseDatePreset || 'this_month',
      from: S.postPurchaseDateFrom || '',
      to: S.postPurchaseDateTo || '',
      reprint: S.postPurchaseReprint || 'all',
      q: S.postPurchaseSearch || '',
      month: S.postPurchaseMonth || '',
    };
  }

  function toQueryParams(filters) {
    const params = new URLSearchParams();
    params.set('limit', filters.limit || '500');
    params.set('datePreset', filters.datePreset || 'this_month');
    params.set('reprint', filters.reprint || 'all');
    if (filters.q) params.set('q', filters.q);
    if (filters.month) params.set('month', filters.month);
    if ((filters.datePreset || '') === 'custom') {
      if (filters.from) params.set('from', filters.from);
      if (filters.to) params.set('to', filters.to);
    }
    return params;
  }

  window.PrintGuardOrderPipelineFilters = {
    getFiltersFromState,
    toQueryParams,
  };
})();
