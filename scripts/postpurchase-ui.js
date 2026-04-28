'use strict';

(() => {
  const POST_PURCHASE_STEPS = [
    { stage: 'SUBMIT_TOOL_PROCESSED', label: 'Submit Tool', field: 'submit_tool_processed_at' },
    { stage: 'ONYX_SEEN', label: 'ONYX', field: 'onyx_seen_at' },
    { stage: 'COLORADO_PRINTED', label: 'Colorado', field: 'colorado_printed_at' },
  ];

  const POST_PURCHASE_ISSUE_REASONS = [
    'Oil drop',
    'Bent paper',
    'Color issue',
    'Cut issue',
    'Printer error',
    'Other',
  ];

  const state = {
    S: null,
    cfg: null,
    el: null,
    elSet: null,
    esc: null,
    fmtDT: null,
    showToast: null,
    applyRoleUI: null,
    adminJsonHeaders: null,
    postPurchaseHeaders: null,
    postPurchaseJsonHeaders: null,
    postPurchaseErrorMessage: null,
    requirePostPurchasePinForScreen: null,
    renderPostPurchaseAccessRequired: null,
    fetchImpl: null,
  };

  function initPostPurchaseUI(deps) {
    Object.assign(state, deps || {});
    if (!state.S || !state.cfg || !state.el || !state.elSet) {
      throw new Error('Missing Post Purchase UI dependencies');
    }
  }

  function cleanApiError(error) {
    if (typeof state.postPurchaseErrorMessage === 'function') {
      return state.postPurchaseErrorMessage(error);
    }
    return error && error.message ? error.message : 'Database/API unavailable. Try refresh later.';
  }

  async function readJsonResponse(res, fallbackMessage) {
    const text = await res.text().catch(() => '');
    let payload = {};
    if (text) {
      try {
        payload = JSON.parse(text);
      } catch (error) {
        payload = {};
      }
    }
    if (!res.ok || payload.ok === false) {
      const message = payload.error || fallbackMessage || `Request failed (${res.status})`;
      const error = new Error(res.status >= 500 ? 'Database/API unavailable. Try refresh later.' : message);
      error.status = res.status;
      error.payload = payload;
      throw error;
    }
    return payload;
  }

  function getPostPurchaseUpdateKey(externalOrderId, stage) {
    return `${externalOrderId || ''}::${stage || ''}`;
  }

  function isPostPurchaseStepDone(row, step) {
    const statuses = row && row.statuses ? row.statuses : {};
    return Boolean(statuses[step.stage] || row?.[step.field]);
  }

  function getPostPurchaseStepCount(row) {
    return POST_PURCHASE_STEPS.filter(step => isPostPurchaseStepDone(row, step)).length;
  }

  function isPostPurchaseProductionComplete(row) {
    return getPostPurchaseStepCount(row) === POST_PURCHASE_STEPS.length;
  }

  function isPostPurchaseDone(row) {
    return isPostPurchaseProductionComplete(row);
  }

  function getPostPurchaseState(row) {
    const count = getPostPurchaseStepCount(row);
    if (count === 0) return { key: 'new', label: 'New' };
    if (count === POST_PURCHASE_STEPS.length) return { key: 'done', label: 'Done' };
    return { key: 'progress', label: 'In progress' };
  }

  function getSearchedPostPurchaseOrders() {
    const query = String(state.S.postPurchaseSearch || '').trim().toLowerCase();
    return (state.S.postPurchaseOrders || []).filter(row => {
      const haystack = [
        row.order_number,
        row.external_order_id,
        row.customer_order_id,
        row.status,
        row.issue_reason,
        row.issue_note,
      ].filter(Boolean).join(' ').toLowerCase();
      return !query || haystack.includes(query);
    });
  }

  function getFilteredPostPurchaseOrders() {
    const filter = state.S.postPurchaseFilter || 'open';
    return getSearchedPostPurchaseOrders().filter(row => {
      const done = isPostPurchaseDone(row);
      if (filter === 'completed') return done;
      if (filter === 'all') return true;
      return !done;
    });
  }

  function formatPostPurchaseTime(value) {
    if (!value) return '-';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return state.fmtDT(value);
    const dd = String(date.getDate()).padStart(2, '0');
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const hh = String(date.getHours()).padStart(2, '0');
    const min = String(date.getMinutes()).padStart(2, '0');
    return `${dd}.${mm}. ${hh}:${min}`;
  }

  function canEditPostPurchaseOrders() {
    return Boolean(state.cfg.postPurchasePin || state.cfg.adminPin);
  }

  function postPurchaseToggleControl(label, row, stage) {
    const step = POST_PURCHASE_STEPS.find(item => item.stage === stage) || { stage };
    const checked = isPostPurchaseStepDone(row, step);
    const externalOrderId = row && row.external_order_id ? row.external_order_id : '';
    const updateKey = getPostPurchaseUpdateKey(externalOrderId, stage);
    const disabled = !canEditPostPurchaseOrders() || Boolean(state.S.postPurchaseUpdating && state.S.postPurchaseUpdating[updateKey]);
    const meta = stage === 'SUBMIT_TOOL_PROCESSED' && checked
      ? getSubmitToolMeta(row)
      : '';
    return `<label class="pp-step-toggle ${checked ? 'checked' : ''} ${disabled ? 'disabled' : ''}">
      <input
        type="checkbox"
        class="pp-stage-toggle"
        data-external-order-id="${state.esc(externalOrderId)}"
        data-stage="${state.esc(stage)}"
        ${checked ? 'checked' : ''}
        ${disabled ? 'disabled' : ''}
      >
      <span class="pp-step-box"></span>
      <span class="pp-step-text">
        <span class="pp-step-label">${state.esc(label)}</span>
        ${meta ? `<span class="pp-step-meta">${state.esc(meta)}</span>` : ''}
      </span>
    </label>`;
  }

  function getSubmitToolMeta(row) {
    const status = row && row.submit_tool_status ? row.submit_tool_status : 'manual';
    const value = row && (row.submit_tool_at || row.submit_tool_processed_at);
    const time = value ? formatPostPurchaseTime(value) : '';
    if (status === 'confirmed') return time ? `confirmed ${time}` : 'confirmed';
    return time ? `manual ${time}` : 'manual';
  }

  function postPurchaseIssueControls(row) {
    const externalOrderId = row && row.external_order_id ? row.external_order_id : '';
    const updateKey = getPostPurchaseUpdateKey(externalOrderId, 'ISSUE');
    const disabled = !canEditPostPurchaseOrders() || Boolean(state.S.postPurchaseUpdating && state.S.postPurchaseUpdating[updateKey]);
    const enabled = Boolean(row && row.reprint_needed);
    const reason = row && row.issue_reason ? row.issue_reason : '';
    const note = row && row.issue_note ? row.issue_note : '';
    const reasonButtons = POST_PURCHASE_ISSUE_REASONS.map(value => (
      `<button
        type="button"
        class="pp-reason-chip ${value === reason ? 'active' : ''}"
        data-external-order-id="${state.esc(externalOrderId)}"
        data-issue-reason="${state.esc(value)}"
        ${disabled ? 'disabled' : ''}
      >${state.esc(value)}</button>`
    )).join('');

    return `<div class="pp-issue-box ${enabled ? 'active' : ''}">
      <label class="pp-reprint-toggle ${enabled ? 'checked' : ''} ${disabled ? 'disabled' : ''}">
        <input
          type="checkbox"
          class="pp-reprint-needed"
          data-external-order-id="${state.esc(externalOrderId)}"
          ${enabled ? 'checked' : ''}
          ${disabled ? 'disabled' : ''}
        >
        <span class="pp-step-box"></span>
        <span class="pp-step-label">Reprint needed</span>
      </label>
      ${enabled ? `<div class="pp-issue-fields">
        <div class="pp-reason-chips">${reasonButtons}</div>
        <input type="text" class="pp-issue-note" data-external-order-id="${state.esc(externalOrderId)}" value="${state.esc(note)}" placeholder="Optional note" ${disabled ? 'disabled' : ''}>
        <button type="button" class="pp-reprinted-btn" data-external-order-id="${state.esc(externalOrderId)}" ${disabled ? 'disabled' : ''}>Reprinted</button>
      </div>` : ''}
    </div>`;
  }

  async function loadPostPurchaseOrders(force = false) {
    if (state.S.postPurchaseLoading) return;
    if (state.S.postPurchaseLoaded && !force) {
      renderPostPurchaseOrders();
      return;
    }
    if (!state.requirePostPurchasePinForScreen()) return;

    state.S.postPurchaseLoading = true;
    state.elSet('postpurchase-status', 'Loading...');
    const wrap = state.el('postpurchase-orders-wrap');
    if (wrap) {
      wrap.innerHTML = `<div class="loading-state"><div class="spinner"></div><p>Loading Post Purchase orders...</p></div>`;
    }

    try {
      const res = await state.fetchImpl('/.netlify/functions/postpurchase-orders?limit=200', {
        headers: state.postPurchaseHeaders(),
        cache: 'no-store',
      });
      const payload = await readJsonResponse(res, 'Failed to load Post Purchase orders');
      state.S.postPurchaseOrders = Array.isArray(payload.rows) ? payload.rows : [];
      state.S.postPurchaseLoaded = true;
      renderPostPurchaseOrders();
      state.elSet('postpurchase-status', `${state.S.postPurchaseOrders.length} orders loaded`);
    } catch (error) {
      const message = cleanApiError(error);
      if (wrap && !(state.S.postPurchaseOrders || []).length) {
        wrap.innerHTML = `<div class="empty-state"><div class="empty-state-icon">⚠</div><p>Failed to load Post Purchase orders.</p><div class="table-empty-note">${state.esc(message)}</div><button class="btn-sm" type="button" data-pp-retry="true">Refresh</button></div>`;
        wrap.querySelector('[data-pp-retry="true"]')?.addEventListener('click', () => loadPostPurchaseOrders(true));
      } else if (wrap) {
        renderPostPurchaseOrders();
      }
      state.elSet('postpurchase-status', 'Load failed');
      state.showToast(message || 'Failed to load Post Purchase orders.', 'error');
    } finally {
      state.S.postPurchaseLoading = false;
    }
  }

  function renderPostPurchaseOrders() {
    const wrap = state.el('postpurchase-orders-wrap');
    if (!wrap) return;

    const searchedOrders = getSearchedPostPurchaseOrders();
    const openCount = searchedOrders.filter(row => !isPostPurchaseDone(row)).length;
    const completedCount = searchedOrders.filter(row => isPostPurchaseDone(row)).length;
    const allCount = searchedOrders.length;
    const rowsToShow = getFilteredPostPurchaseOrders();
    const filter = state.S.postPurchaseFilter || 'open';
    const totalCount = (state.S.postPurchaseOrders || []).length;

    if (!allCount) {
      wrap.innerHTML = `<div class="pp-filter-tabs">
        <button class="pp-filter-tab active" data-pp-filter="open">Open <span>0</span></button>
        <button class="pp-filter-tab" data-pp-filter="completed">Completed <span>0</span></button>
        <button class="pp-filter-tab" data-pp-filter="all">All <span>0</span></button>
      </div>
      <div class="empty-state"><div class="empty-state-icon">─</div><p>${totalCount ? 'No orders match these filters.' : 'No Post Purchase orders stored yet.'}</p></div>`;
      bindPostPurchaseFilterTabs(wrap);
      return;
    }

    const filterTabs = `<div class="pp-filter-tabs">
      <button class="pp-filter-tab ${filter === 'open' ? 'active' : ''}" data-pp-filter="open">Open <span>${openCount}</span></button>
      <button class="pp-filter-tab ${filter === 'completed' ? 'active' : ''}" data-pp-filter="completed">Completed <span>${completedCount}</span></button>
      <button class="pp-filter-tab ${filter === 'all' ? 'active' : ''}" data-pp-filter="all">All <span>${allCount}</span></button>
    </div>`;

    if (!rowsToShow.length) {
      const emptyText = filter === 'open'
        ? 'No open orders. Everything is completed.'
        : filter === 'completed'
          ? 'No completed orders yet.'
          : 'No orders match this view.';
      wrap.innerHTML = `${filterTabs}<div class="empty-state"><div class="empty-state-icon">✓</div><p>${state.esc(emptyText)}</p></div>`;
      bindPostPurchaseFilterTabs(wrap);
      state.elSet('postpurchase-status', `${openCount} open · ${completedCount} done`);
      return;
    }

    const rows = rowsToShow.map((row) => {
      const stateInfo = getPostPurchaseState(row);
      const controls = POST_PURCHASE_STEPS.map(step =>
        postPurchaseToggleControl(step.label, row, step.stage)
      ).join('');
      const issueControls = isPostPurchaseProductionComplete(row) ? postPurchaseIssueControls(row) : '';
      const secondary = row.status && row.status !== '-' ? row.status : '';
      const detailTitle = row.external_order_id ? `External ID ${row.external_order_id}` : '';
      const issueBadge = row.reprint_needed ? '<span class="pp-issue-badge">Issue</span>' : '';

      return `<tr class="${row.reprint_needed ? 'pp-issue-row' : ''}">
        <td>
          <div class="pp-order-main" title="${state.esc(detailTitle)}">${state.esc(row.order_number || '-')}</div>
          ${secondary ? `<div class="pp-order-sub" title="${state.esc(secondary)}">${state.esc(secondary)}</div>` : ''}
        </td>
        <td class="pp-received">${formatPostPurchaseTime(row.received_at || row.api_seen_at)}</td>
        <td><div class="pp-progress-cell"><div class="pp-step-row">${controls}</div>${issueControls}</div></td>
        <td><span class="pp-state-badge ${stateInfo.key}">${state.esc(stateInfo.label)}</span>${issueBadge}</td>
      </tr>`;
    }).join('');

    wrap.innerHTML = `${filterTabs}<table class="data-table pp-queue-table">
      <thead><tr>
        <th>Order</th>
        <th>Received</th>
        <th>Progress</th>
        <th>State</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>`;

    bindPostPurchaseFilterTabs(wrap);
    bindPostPurchaseRowEvents(wrap);
    state.elSet('postpurchase-status', `${openCount} open · ${completedCount} done`);
    state.applyRoleUI();
  }

  function bindPostPurchaseFilterTabs(wrap) {
    wrap.querySelectorAll('.pp-filter-tab').forEach(button => {
      button.addEventListener('click', () => {
        state.S.postPurchaseFilter = button.dataset.ppFilter || 'open';
        renderPostPurchaseOrders();
      });
    });
  }

  function bindPostPurchaseRowEvents(wrap) {
    wrap.querySelectorAll('.pp-stage-toggle').forEach((input) => {
      input.addEventListener('change', () => {
        setPostPurchaseStage(
          input.dataset.externalOrderId,
          input.dataset.stage,
          input.checked
        );
      });
    });
    wrap.querySelectorAll('.pp-reprint-needed').forEach((input) => {
      input.addEventListener('change', () => {
        const externalOrderId = input.dataset.externalOrderId;
        const row = (state.S.postPurchaseOrders || []).find(item => item.external_order_id === externalOrderId);
        setPostPurchaseIssue(externalOrderId, {
          reprintNeeded: input.checked,
          issueReason: input.checked ? (row?.issue_reason || 'Other') : '',
          note: input.checked ? (row?.issue_note || '') : '',
        });
      });
    });
    wrap.querySelectorAll('.pp-reason-chip').forEach((button) => {
      button.addEventListener('click', () => {
        const externalOrderId = button.dataset.externalOrderId;
        const row = (state.S.postPurchaseOrders || []).find(item => item.external_order_id === externalOrderId);
        setPostPurchaseIssue(externalOrderId, {
          reprintNeeded: true,
          issueReason: button.dataset.issueReason || 'Other',
          note: row?.issue_note || '',
        });
      });
    });
    wrap.querySelectorAll('.pp-issue-note').forEach((input) => {
      input.addEventListener('change', () => {
        const externalOrderId = input.dataset.externalOrderId;
        const row = (state.S.postPurchaseOrders || []).find(item => item.external_order_id === externalOrderId);
        setPostPurchaseIssue(externalOrderId, {
          reprintNeeded: true,
          issueReason: row?.issue_reason || 'Other',
          note: input.value,
        });
      });
    });
    wrap.querySelectorAll('.pp-reprinted-btn').forEach((button) => {
      button.addEventListener('click', () => {
        const externalOrderId = button.dataset.externalOrderId;
        const row = (state.S.postPurchaseOrders || []).find(item => item.external_order_id === externalOrderId);
        setPostPurchaseIssue(externalOrderId, {
          reprintNeeded: false,
          issueReason: row?.issue_reason || 'Other',
          note: row?.issue_note || '',
          reprintedAt: new Date().toISOString(),
        });
      });
    });
  }

  async function syncPostPurchaseOrdersManual() {
    try {
      state.elSet('postpurchase-status', 'Syncing...');
      const res = await state.fetchImpl('/.netlify/functions/postpurchase-orders', {
        method: 'POST',
        headers: {
          ...state.adminJsonHeaders(),
          'x-internal-sync': 'true',
        },
        cache: 'no-store',
        body: JSON.stringify({ limit: 100 }),
      });
      const payload = await readJsonResponse(res, 'Failed to sync Post Purchase orders');
      state.showToast(`Orders sync OK · +${payload.inserted || 0} / ~${payload.updated || 0}`, 'success');
      state.S.postPurchaseLoaded = false;
      await loadPostPurchaseOrders(true);
    } catch (error) {
      state.elSet('postpurchase-status', 'Sync failed');
      state.showToast(cleanApiError(error), 'error');
    }
  }

  async function setPostPurchaseStage(externalOrderId, stage, completed) {
    const updateKey = getPostPurchaseUpdateKey(externalOrderId, stage);
    const previousOrders = (state.S.postPurchaseOrders || []).map(row => ({
      ...row,
      statuses: { ...(row.statuses || {}) },
    }));
    state.S.postPurchaseUpdating = state.S.postPurchaseUpdating || {};
    state.S.postPurchaseUpdating[updateKey] = true;
    state.S.postPurchaseOrders = (state.S.postPurchaseOrders || []).map(row => {
      if (row.external_order_id !== externalOrderId) return row;
      return {
        ...row,
        statuses: {
          ...(row.statuses || {}),
          [stage]: Boolean(completed),
        },
      };
    });
    renderPostPurchaseOrders();
    state.elSet('postpurchase-status', 'Saving...');

    try {
      const res = await state.fetchImpl('/.netlify/functions/postpurchase-orders', {
        method: 'PUT',
        headers: {
          ...state.postPurchaseJsonHeaders(),
        },
        cache: 'no-store',
        body: JSON.stringify({
          externalOrderId,
          stage,
          completed,
        }),
      });
      const payload = await readJsonResponse(res, 'Failed to update Post Purchase order');

      const updatedRow = payload.row || null;
      state.S.postPurchaseOrders = (state.S.postPurchaseOrders || []).map((row) =>
        row.external_order_id === externalOrderId && updatedRow ? updatedRow : row
      );
      state.showToast('Order status updated.', 'success');
    } catch (error) {
      state.S.postPurchaseOrders = previousOrders;
      state.showToast(cleanApiError(error), 'error');
      state.elSet('postpurchase-status', 'Update failed');
      renderPostPurchaseOrders();
      return;
    } finally {
      delete state.S.postPurchaseUpdating[updateKey];
      renderPostPurchaseOrders();
    }
  }

  async function setPostPurchaseIssue(externalOrderId, patch) {
    const updateKey = getPostPurchaseUpdateKey(externalOrderId, 'ISSUE');
    const previousOrders = (state.S.postPurchaseOrders || []).map(row => ({
      ...row,
      statuses: { ...(row.statuses || {}) },
    }));
    const reprintNeeded = Boolean(patch && patch.reprintNeeded);
    const issueReason = reprintNeeded ? String((patch && patch.issueReason) || 'Other').trim() : '';
    const note = reprintNeeded ? String((patch && patch.note) || '').trim() : '';
    const reprintedAt = patch && patch.reprintedAt ? String(patch.reprintedAt) : null;

    if (reprintNeeded && !issueReason) {
      state.showToast('Issue reason is required.', 'error');
      renderPostPurchaseOrders();
      return;
    }

    state.S.postPurchaseUpdating = state.S.postPurchaseUpdating || {};
    state.S.postPurchaseUpdating[updateKey] = true;
    state.S.postPurchaseOrders = (state.S.postPurchaseOrders || []).map(row => {
      if (row.external_order_id !== externalOrderId) return row;
      return {
        ...row,
        reprint_needed: reprintNeeded,
        issue_reason: issueReason,
        issue_note: note,
        reprinted_at: reprintedAt || row.reprinted_at || null,
      };
    });
    renderPostPurchaseOrders();
    state.elSet('postpurchase-status', 'Saving issue...');

    try {
      const res = await state.fetchImpl('/.netlify/functions/postpurchase-orders', {
        method: 'PUT',
        headers: {
          ...state.postPurchaseJsonHeaders(),
        },
        cache: 'no-store',
        body: JSON.stringify({
          externalOrderId,
          reprintNeeded,
          issueReason,
          note,
          reprintedAt,
        }),
      });
      const payload = await readJsonResponse(res, 'Failed to update issue');

      const updatedRow = payload.row || null;
      state.S.postPurchaseOrders = (state.S.postPurchaseOrders || []).map(row =>
        row.external_order_id === externalOrderId && updatedRow ? updatedRow : row
      );
      state.showToast(reprintedAt ? 'Order marked as reprinted.' : reprintNeeded ? 'Issue marked.' : 'Issue cleared.', 'success');
    } catch (error) {
      state.S.postPurchaseOrders = previousOrders;
      state.showToast(cleanApiError(error), 'error');
      state.elSet('postpurchase-status', 'Issue update failed');
      renderPostPurchaseOrders();
      return;
    } finally {
      delete state.S.postPurchaseUpdating[updateKey];
      renderPostPurchaseOrders();
    }
  }

  window.PrintGuardPostPurchaseUI = {
    initPostPurchaseUI,
    loadPostPurchaseOrders,
    renderPostPurchaseOrders,
    syncPostPurchaseOrdersManual,
  };
})();
