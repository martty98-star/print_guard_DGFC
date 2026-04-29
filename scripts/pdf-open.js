'use strict';

(() => {
  function uncToFileHref(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    if (!raw.startsWith('\\\\')) return raw;
    return 'file://///' + raw.replace(/^\\\\/, '').replace(/\\/g, '/');
  }

  async function copyText(value) {
    const text = String(value || '');
    if (!text) return;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', 'readonly');
    area.style.position = 'fixed';
    area.style.left = '-9999px';
    document.body.appendChild(area);
    area.select();
    document.execCommand('copy');
    area.remove();
  }

  async function openPdfPath(options) {
    const pdfPath = String(options.path || '').trim();
    if (!pdfPath) return;
    const showToast = options.showToast || function noop() {};
    const fetchImpl = options.fetchImpl || window.fetch.bind(window);
    const helperUrls = [
      'http://127.0.0.1:17891/open-pdf',
      'http://localhost:17891/open-pdf',
    ];

    for (const url of helperUrls) {
      try {
        const response = await fetchImpl(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ path: pdfPath }),
        });
        if (response.ok) {
          showToast('PDF open request sent', 'success');
          return;
        }
      } catch (error) {
        console.debug('PDF helper unavailable', url, error);
      }
    }

    try {
      window.open(options.fileHref || uncToFileHref(pdfPath), '_blank', 'noreferrer');
    } catch (error) {
      console.debug('Direct PDF open blocked', error);
    }
    await copyText(pdfPath);
    showToast('PDF path copied. Browser blocked direct open.', 'error');
  }

  window.PrintGuardPdfOpen = {
    copyText,
    openPdfPath,
    uncToFileHref,
  };
})();
