'use strict';

(() => {
  const Api = window.PrintGuardOrderPipelineApi;
  const Filters = window.PrintGuardOrderPipelineFilters;
  const Render = window.PrintGuardOrderPipelineRender;
  const ReprintModal = window.PrintGuardReprintModal;
  const PdfOpen = window.PrintGuardPdfOpen;

  if (!Api || !Filters || !Render || !ReprintModal || !PdfOpen) {
    throw new Error('Missing Processed Print Orders modules');
  }

  const state = {
    S: null,
    cfg: null,
    el: null,
    elSet: null,
    esc: null,
    showToast: null,
    applyRoleUI: null,
    postPurchaseHeaders: null,
    postPurchaseJsonHeaders: null,
    postPurchaseErrorMessage: null,
    requirePostPurchasePinForScreen: null,
    renderPostPurchaseAccessRequired: null,
    fetchImpl: null,
    reprintPendingKeys: new Set(),
  };

  function initPostPurchaseUI(deps) {
    Object.assign(state, deps || {});
    if (!state.S || !state.cfg || !state.el || !state.elSet) {
      throw new Error('Missing Processed Print Orders UI dependencies');
    }
  }

  function cleanApiError(error) {
    if (typeof state.postPurchaseErrorMessage === 'function') {
      return state.postPurchaseErrorMessage(error);
    }
    return error && error.message ? error.message : 'Database/API unavailable. Try refresh later.';
  }

  function updateMonthFilter(months) {
    const select = state.el('postpurchase-month-filter');
    if (!select) return;
    const current = state.S.postPurchaseMonth || '';
    const options = ['<option value="">All months</option>']
      .concat((months || []).map(month => `<option value="${state.esc(month)}">${state.esc(month)}</option>`));
    select.innerHTML = options.join('');
    select.value = current;
  }

  function updateFilterControls() {
    const preset = state.el('postpurchase-date-preset');
    const from = state.el('postpurchase-date-from');
    const to = state.el('postpurchase-date-to');
    const reprint = state.el('postpurchase-reprint-filter');
    if (preset) preset.value = state.S.postPurchaseDatePreset || 'this_month';
    if (from) from.value = state.S.postPurchaseDateFrom || '';
    if (to) to.value = state.S.postPurchaseDateTo || '';
    if (reprint) reprint.value = state.S.postPurchaseReprint || 'all';
  }

  function getActor() {
    return (state.cfg && state.cfg.userName) || (state.cfg && state.cfg.role) || 'operator';
  }

  function getRenderOptions() {
    return {
      esc: state.esc,
      reprintPendingKeys: state.reprintPendingKeys,
      toFileHref: PdfOpen.uncToFileHref,
    };
  }

  async function createReprintRequest(payload) {
    try {
      const result = await Api.createReprintRequest({
        fetchImpl: state.fetchImpl,
        headers: state.postPurchaseJsonHeaders(),
        payload: {
          ...payload,
          requestedBy: getActor(),
          workstationId: state.cfg && state.cfg.deviceId,
        },
      });
      state.reprintPendingKeys.add(Render.getReprintKey(payload.orderId, payload.printFilePath));
      state.showToast(result && result.alreadyPending ? 'Reprint request already pending' : 'Reprint request created', 'success');
      renderPostPurchaseOrders();
      return result;
    } catch (error) {
      console.error('Reprint request failed', error);
      state.showToast('Reprint request could not be created', 'error');
      throw error;
    }
  }

  async function resolveReprintRequest(payload) {
    try {
      await Api.resolveReprintRequest({
        fetchImpl: state.fetchImpl,
        headers: state.postPurchaseJsonHeaders(),
        payload,
      });
      state.reprintPendingKeys.delete(Render.getReprintKey(payload.orderId, payload.printFilePath));
      state.showToast('Reprint request resolved', 'success');
      state.S.postPurchaseLoaded = false;
      await loadPostPurchaseOrders(true);
    } catch (error) {
      console.error('Resolve reprint request failed', error);
      state.showToast(error && error.message ? error.message : 'Reprint request could not be resolved', 'error');
      throw error;
    }
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
    if (wrap && !(state.S.postPurchaseOrders || []).length) {
      wrap.innerHTML = `<div class="loading-state"><div class="spinner"></div><p>Loading processed orders...</p></div>`;
    }

    try {
      const payload = await Api.loadOrderPipeline({
        fetchImpl: state.fetchImpl,
        headers: state.postPurchaseHeaders(),
        filters: Filters.getFiltersFromState(state.S),
      });
      state.S.postPurchaseOrders = Array.isArray(payload.rows) ? payload.rows : [];
      state.S.postPurchaseLoaded = true;
      updateMonthFilter(payload.months || []);
      updateFilterControls();
      renderPostPurchaseOrders();
      state.elSet('postpurchase-status', `${state.S.postPurchaseOrders.length} pipeline orders`);
    } catch (error) {
      console.error('Order pipeline load failed', error);
      const message = cleanApiError(error);
      if (wrap && !(state.S.postPurchaseOrders || []).length) {
        wrap.innerHTML = Render.renderError(message, state.esc);
        wrap.querySelector('[data-pp-retry="true"]')?.addEventListener('click', () => loadPostPurchaseOrders(true));
      } else {
        renderPostPurchaseOrders();
      }
      state.elSet('postpurchase-status', 'Load failed');
      state.showToast(message, 'error');
    } finally {
      state.S.postPurchaseLoading = false;
    }
  }

  function renderPostPurchaseOrders() {
    const wrap = state.el('postpurchase-orders-wrap');
    if (!wrap) return;
    wrap.innerHTML = Render.renderOrders(state.S.postPurchaseOrders || [], getRenderOptions());
    bindProcessedOrderActions(wrap);
    if (typeof state.applyRoleUI === 'function') state.applyRoleUI();
  }

  function bindProcessedOrderActions(wrap) {
    wrap.querySelectorAll('[data-copy-path]').forEach((button) => {
      button.addEventListener('click', async () => {
        try {
          await PdfOpen.copyText(button.dataset.copyPath || '');
          state.showToast('Path copied', 'success');
        } catch (error) {
          console.error('Copy path failed', error);
          state.showToast('Copy failed', 'error');
        }
      });
    });
    wrap.querySelectorAll('[data-open-pdf-path]').forEach((button) => {
      button.addEventListener('click', () => {
        PdfOpen.openPdfPath({
          path: button.dataset.openPdfPath || '',
          fileHref: button.dataset.openPdfHref || '',
          fetchImpl: state.fetchImpl,
          showToast: state.showToast,
        });
      });
    });
    wrap.querySelectorAll('[data-reprint-order-id]').forEach((button) => {
      button.addEventListener('click', () => {
        ReprintModal.open({
          orderId: button.dataset.reprintOrderId,
          orderName: button.dataset.reprintOrderName,
          printFilePath: button.dataset.printFilePath || '',
          printFileLabel: button.dataset.printFileLabel,
        }, {
          esc: state.esc,
          fileNameFromPath: Render.fileNameFromPath,
          onSubmit: createReprintRequest,
        });
      });
    });
    wrap.querySelectorAll('[data-resolve-reprint-order-id]').forEach((button) => {
      button.addEventListener('click', () => {
        button.disabled = true;
        resolveReprintRequest({
          orderId: button.dataset.resolveReprintOrderId,
          printFilePath: button.dataset.resolvePrintFilePath || '',
        }).catch(() => {
          button.disabled = false;
        });
      });
    });
  }

  async function syncPostPurchaseOrdersManual() {
    state.showToast('Processed XML sync runs on the workstation/server task.', 'error');
  }

  window.PrintGuardPostPurchaseUI = {
    initPostPurchaseUI,
    loadPostPurchaseOrders,
    renderPostPurchaseOrders,
    syncPostPurchaseOrdersManual,
  };
})();
