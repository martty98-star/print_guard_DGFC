(function attachChecklistApi(root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
    return;
  }
  root.PrintGuardChecklistApi = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function createChecklistApi() {
  'use strict';

  function getFetch(options) {
    if (options && options.fetchImpl) return options.fetchImpl;
    if (typeof window !== 'undefined' && window.fetch) return window.fetch.bind(window);
    return fetch;
  }

  async function request(method, url, body, options) {
    const fetchImpl = getFetch(options);
    const response = await fetchImpl(url, {
      method,
      headers: {
        'content-type': 'application/json',
        ...(options && options.headers ? options.headers : {}),
      },
      cache: 'no-store',
      body: body == null ? undefined : JSON.stringify(body),
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.ok === false) {
      const error = new Error(payload.error || ('Checklist request failed: ' + response.status));
      error.status = response.status;
      error.payload = payload;
      throw error;
    }

    return payload;
  }

  function listChecklistItems(options) {
    return request('GET', '/.netlify/functions/checklist-items', null, options);
  }

  function createChecklistItem(item, options) {
    return request('POST', '/.netlify/functions/checklist-items', item, options);
  }

  function updateChecklistItem(item, options) {
    return request('PUT', '/.netlify/functions/checklist-items', item, options);
  }

  function deleteChecklistItem(id, options) {
    return request('DELETE', '/.netlify/functions/checklist-items', { id }, options);
  }

  function completeChecklistOccurrence(payload, options) {
    return request('POST', '/.netlify/functions/checklist-completions', payload, options);
  }

  function listChecklistCompletions(options) {
    const limit = Math.max(1, Number(options && options.limit) || 200);
    return request('GET', '/.netlify/functions/checklist-completions?limit=' + encodeURIComponent(String(limit)), null, options);
  }

  function evaluateChecklistReminders(payload, options) {
    return request('POST', '/.netlify/functions/checklist-evaluate', payload || {}, options);
  }

  return {
    createChecklistItem,
    deleteChecklistItem,
    evaluateChecklistReminders,
    completeChecklistOccurrence,
    listChecklistItems,
    listChecklistCompletions,
    updateChecklistItem,
  };
});
