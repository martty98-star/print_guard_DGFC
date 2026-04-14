(function attachChecklistApi(root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
    return;
  }
  root.PrintGuardChecklistApi = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function createChecklistApi() {
  'use strict';

  async function request(method, url, body, options) {
    const fetchImpl = (options && options.fetchImpl) || fetch;
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
      throw new Error(payload.error || ('Checklist request failed: ' + response.status));
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

  function evaluateChecklistReminders(payload, options) {
    return request('POST', '/.netlify/functions/checklist-evaluate', payload || {}, options);
  }

  return {
    createChecklistItem,
    deleteChecklistItem,
    evaluateChecklistReminders,
    listChecklistItems,
    updateChecklistItem,
  };
});
