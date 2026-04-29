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
    const reason = selected ? selected.value : '';
    const note = String((dialog && dialog.querySelector('#pp-reprint-note')?.value) || '').trim();

    if (!reason) {
      if (errorNode) errorNode.textContent = 'Reason is required.';
      return;
    }
    if (reason === 'Other' && !note) {
      if (errorNode) errorNode.textContent = 'Note is required for Other.';
      return;
    }

    submitting = true;
    if (createButton) createButton.disabled = true;
    if (errorNode) errorNode.textContent = '';

    try {
      await options.onSubmit({
        ...dialogState,
        reason,
        note,
      });
      close();
    } catch (error) {
      if (errorNode) errorNode.textContent = 'Reprint request could not be created.';
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
    };

    const reasonOptions = REPRINT_REASONS.map((reason) =>
      `<label class="pp-reprint-reason"><input type="radio" name="pp-reprint-reason" value="${esc(reason)}"> <span>${esc(reason)}</span></label>`
    ).join('');

    const host = document.createElement('div');
    host.id = 'pp-reprint-dialog';
    host.className = 'pp-modal-backdrop';
    host.innerHTML = `<div class="pp-modal" role="dialog" aria-modal="true" aria-labelledby="pp-reprint-title">
      <div class="pp-modal-head">
        <h2 id="pp-reprint-title">Request reprint</h2>
        <button class="btn-sm" type="button" data-reprint-cancel="true">Cancel</button>
      </div>
      <div class="pp-modal-body">
        <div class="pp-modal-field"><span>Order</span><strong>${esc(dialogState.orderName || '-')}</strong></div>
        <div class="pp-modal-field"><span>PDF</span><strong>${esc(dialogState.printFileLabel || '-')}</strong><small>${esc(dialogState.printFilePath || '')}</small></div>
        <div class="pp-reprint-reasons">${reasonOptions}</div>
        <textarea id="pp-reprint-note" class="pp-reprint-note" placeholder="Add details if needed"></textarea>
        <div class="pp-reprint-error" id="pp-reprint-error"></div>
      </div>
      <div class="pp-modal-actions">
        <button class="btn-sm" type="button" data-reprint-cancel="true">Cancel</button>
        <button class="btn-sm" type="button" id="pp-reprint-create">Create request</button>
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
