'use strict';

(() => {
  const DEFAULT_PDF_PROXY_BASE = 'https://printguard-scan.desenio.cz';

  function getPdfProxyBase() {
    const configured = String(
      window.PRINTGUARD_PDF_PROXY_BASE ||
      window.SCAN_CAPTURE_API_BASE ||
      DEFAULT_PDF_PROXY_BASE
    ).trim();
    return configured.replace(/\/+$/, '');
  }

  function buildPdfProxyUrl(options) {
    const params = new URLSearchParams();
    const orderId = Number(options && options.orderId);
    const fileIndex = Number(options && options.fileIndex);
    const orderName = String(options && options.orderName || '').trim();
    if (Number.isInteger(orderId) && orderId > 0) {
      params.set('orderId', String(orderId));
    } else if (orderName) {
      params.set('orderName', orderName);
    } else {
      return '';
    }
    if (!Number.isInteger(fileIndex) || fileIndex < 0) return '';
    params.set('fileIndex', String(fileIndex));
    if (options && options.download) params.set('download', '1');
    return `${getPdfProxyBase()}/pdf-open?${params.toString()}`;
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

  function openPdfUrl(options) {
    const pdfUrl = String(options.url || '').trim();
    if (!pdfUrl) return;
    const showToast = options.showToast || function noop() {};
    try {
      const popup = window.open(pdfUrl, '_blank', 'noopener,noreferrer');
      if (popup) return;
    } catch (error) {
      console.debug('PDF proxy open blocked', error);
    }
    const anchor = document.createElement('a');
    anchor.href = pdfUrl;
    anchor.target = '_blank';
    anchor.rel = 'noopener noreferrer';
    anchor.click();
    showToast('PDF opening blocked by browser popup settings.', 'error');
  }

  window.PrintGuardPdfOpen = {
    buildPdfProxyUrl,
    copyText,
    getPdfProxyBase,
    openPdfUrl,
  };
})();
