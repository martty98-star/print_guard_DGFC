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
    } else if (action && typeof action === 'object' && typeof action.onClick === 'function') {
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
    toastTimer = setTimeout(() => toast.classList.add('hidden'), actionConfig ? 5000 : 3000);
  }

  global.PrintGuardDomUtils = {
    el,
    elSet,
    showToast,
  };
})(window);
