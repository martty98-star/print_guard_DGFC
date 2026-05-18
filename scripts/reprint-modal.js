'use strict';

(() => {
  const REPRINT_REASONS = [
    'Printer dots / contamination',
    'Cutter oil contamination',
    'Incorrect cut / not cut through',
    'Wrong media',
    'Color issue',
    'Damaged during handling',
    'Missing print',
    'Other',
  ];

  let dialogState = null;
  let submitting = false;

  function t(key) {
    return window.I18N && typeof window.I18N.t === 'function' ? window.I18N.t(key) : key;
  }

  function reasonLabel(reason) {
    const key = `processed.reprint.reason.${String(reason || '').toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
    return t(key);
  }

  function close() {
    const dialog = document.getElementById('pp-reprint-dialog');
    if (dialog) dialog.remove();
    dialogState = null;
    submitting = false;
  }

  async function submit(options) {
    if (submitting || !dialogState) return;
    const dialog = document.getElementById('pp-reprint-dialog');
    const errorNode = dialog && dialog.querySelector('#pp-reprint-error');
    const createButton = dialog && dialog.querySelector('#pp-reprint-create');
    const selected = dialog && dialog.querySelector('input[name="pp-reprint-reason"]:checked');
    const operatorName = String((dialog && dialog.querySelector('#pp-reprint-operator')?.value) || '').trim();
    const reason = selected ? selected.value : '';
    const note = String((dialog && dialog.querySelector('#pp-reprint-note')?.value) || '').trim();

    if (!operatorName) {
      if (errorNode) errorNode.textContent = t('processed.reprint.error.operator');
      return;
    }
    if (!reason) {
      if (errorNode) errorNode.textContent = t('processed.reprint.error.reason');
      return;
    }
    if (reason === 'Other' && !note) {
      if (errorNode) errorNode.textContent = t('processed.reprint.error.other-note');
      return;
    }

    submitting = true;
    if (createButton) createButton.disabled = true;
    if (errorNode) errorNode.textContent = '';

    try {
      await options.onSubmit({
        ...dialogState,
        operatorName,
        reason,
        note,
      });
      close();
    } catch (error) {
      if (errorNode) errorNode.textContent = t('processed.toast.reprint-create-failed');
      if (createButton) createButton.disabled = false;
      submitting = false;
    }
  }

  function open(input, options) {
    close();
    const esc = options.esc;
    dialogState = {
      orderId: input.orderId,
      orderName: input.orderName || input.orderId,
      printFilePath: input.printFilePath,
      printFileLabel: input.printFileLabel || options.fileNameFromPath(input.printFilePath),
      operatorName: input.operatorName || '',
    };

    const reasonOptions = REPRINT_REASONS.map((reason) =>
      `<label class="pp-reprint-reason"><input type="radio" name="pp-reprint-reason" value="${esc(reason)}"> <span>${esc(reasonLabel(reason))}</span></label>`
    ).join('');

    const host = document.createElement('div');
    host.id = 'pp-reprint-dialog';
    host.className = 'pp-modal-backdrop';
    host.innerHTML = `<div class="pp-modal" role="dialog" aria-modal="true" aria-labelledby="pp-reprint-title">
      <div class="pp-modal-head">
        <h2 id="pp-reprint-title">${t('processed.button.request-reprint')}</h2>
        <button class="btn-sm" type="button" data-reprint-cancel="true">${t('btn.cancel')}</button>
      </div>
      <div class="pp-modal-body">
        <div class="pp-modal-field"><span>${t('processed.reprint.order')}</span><strong>${esc(dialogState.orderName || '-')}</strong></div>
        <div class="pp-modal-field"><span>PDF</span><strong>${esc(dialogState.printFileLabel || '-')}</strong><small>${esc(dialogState.printFilePath || '')}</small></div>
        <label class="pp-modal-field"><span>${t('processed.reprint.operator')}</span><input id="pp-reprint-operator" class="input-sm" type="text" value="${esc(dialogState.operatorName || '')}" autocomplete="name"></label>
        <div class="pp-reprint-reasons">${reasonOptions}</div>
        <textarea id="pp-reprint-note" class="pp-reprint-note" placeholder="${t('processed.reprint.note-placeholder')}"></textarea>
        <div class="pp-reprint-error" id="pp-reprint-error"></div>
      </div>
      <div class="pp-modal-actions">
        <button class="btn-sm" type="button" data-reprint-cancel="true">${t('btn.cancel')}</button>
        <button class="btn-sm" type="button" id="pp-reprint-create">${t('processed.reprint.create')}</button>
      </div>
    </div>`;
    document.body.appendChild(host);
    host.querySelectorAll('[data-reprint-cancel]').forEach((button) => {
      button.addEventListener('click', close);
    });
    host.addEventListener('click', (event) => {
      if (event.target === host) close();
    });
    host.querySelector('#pp-reprint-create')?.addEventListener('click', () => submit(options));
  }

  window.PrintGuardReprintModal = {
    close,
    open,
  };
})();
