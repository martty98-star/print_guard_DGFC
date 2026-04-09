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

  function showToast(message, type) {
    const toast = el('toast');
    if (!toast) return;
    toast.classList.remove('hidden');
    toast.textContent = message;
    toast.className = 'toast' + (type ? ' ' + type : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.add('hidden'), 3000);
  }

  global.PrintGuardDomUtils = {
    el,
    elSet,
    showToast,
  };
})(window);
