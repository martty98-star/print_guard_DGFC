(function attachPrintGuardDomUtils(global) {
  'use strict';

  let toastTimer;

  function el(id) {
    return document.getElementById(id);
  }

  function elSet(id, value) {
    const node = el(id);
    if (node) node.textContent = String(value);
  }

  function showToast(message, type, action) {
    const toast = el('toast');
    if (!toast) return;
    toast.classList.remove('hidden');
    toast.innerHTML = '';
    toast.className = 'toast' + (type ? ' ' + type : '');
    const msg = document.createElement('span');
    msg.className = 'toast-message';
    msg.textContent = String(message ?? '');
    toast.appendChild(msg);

    let actionConfig = null;
    if (typeof action === 'function') {
      actionConfig = { label: 'Vrátit zpět', onClick: action };
    } else if (
      action &&
      typeof action === 'object' &&
      typeof action.onClick === 'function'
    ) {
      actionConfig = {
        label: action.label || 'Vrátit zpět',
        onClick: action.onClick,
      };
    }

    if (actionConfig) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'toast-action';
      btn.textContent = actionConfig.label;
      btn.addEventListener('click', () => {
        clearTimeout(toastTimer);
        toast.classList.add('hidden');
        actionConfig.onClick();
      });
      toast.appendChild(btn);
    }

    clearTimeout(toastTimer);
    toastTimer = setTimeout(
      () => toast.classList.add('hidden'),
      actionConfig ? 5000 : 3000,
    );
  }

  function showConfirm(input, onOk) {
    const cfg = typeof input === 'object' && input ? input : { body: input };
    const title = cfg.title || 'Potvrzeni';
    const body = cfg.body || cfg.text || '';
    const confirmLabel = cfg.confirmLabel || 'Potvrdit';
    const cancelLabel = cfg.cancelLabel || 'Zrusit';
    const modal = el('confirm-modal');
    if (!modal) return;
    el('confirm-title').textContent = title;
    el('confirm-text').textContent = body;
    el('confirm-ok').textContent = confirmLabel;
    el('confirm-cancel').textContent = cancelLabel;
    modal.classList.remove('hidden');
    const close = () => modal.classList.add('hidden');
    el('confirm-ok').onclick = () => {
      close();
      onOk();
    };
    el('confirm-cancel').onclick = close;
    el('confirm-close').onclick = close;
  }

  global.PrintGuardDomUtils = {
    el,
    elSet,
    showConfirm,
    showToast,
  };
})(window);
