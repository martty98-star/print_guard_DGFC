'use strict';

(() => {
  const Api = window.PrintGuardDailyReportApi;
  const Auth = window.PrintGuardAuth;
  const AppConfig = window.PrintGuardAppConfig;

  if (!Api || !Auth || !AppConfig) {
    throw new Error('Missing Daily Report dependencies');
  }

  function t(key) {
    return window.I18N && typeof window.I18N.t === 'function' ? window.I18N.t(key) : key;
  }

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function todayInputValue() {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/Prague',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(new Date());
    const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return `${map.year}-${map.month}-${map.day}`;
  }

  function toast(message, type) {
    if (window.PrintGuardDomUtils && typeof window.PrintGuardDomUtils.showToast === 'function') {
      window.PrintGuardDomUtils.showToast(message, type);
      return;
    }
    console[type === 'error' ? 'error' : 'log'](message);
  }

  function mailtoHref(email) {
    return `mailto:?subject=${encodeURIComponent(email.subject || '')}&body=${encodeURIComponent(email.text || '')}`;
  }

  async function copyText(value, successMessage) {
    await navigator.clipboard.writeText(String(value || ''));
    toast(successMessage, 'success');
  }

  function closeModal() {
    document.getElementById('daily-report-modal')?.remove();
  }

  function renderModal(report) {
    closeModal();
    const host = document.createElement('div');
    host.id = 'daily-report-modal';
    host.className = 'modal-overlay';
    host.innerHTML = `<div class="modal-box modal-xl daily-report-modal-box" role="dialog" aria-modal="true" aria-labelledby="daily-report-title">
      <div class="modal-header">
        <h2 id="daily-report-title">${esc(t('daily-report.title'))}</h2>
        <button class="modal-x" type="button" data-daily-report-close="true">x</button>
      </div>
      <div class="modal-body daily-report-modal-body">
        <div class="daily-report-meta">
          <label class="form-group">
            <span>${esc(t('daily-report.date'))}</span>
            <input type="date" id="daily-report-date-input" class="input-sm" value="${esc(report.date || '')}">
          </label>
          <button class="btn-sm" type="button" id="daily-report-reload">${esc(t('daily-report.reload'))}</button>
        </div>
        <div class="daily-report-grid">
          <div class="metric-block"><span class="metric-big">${esc(report.print.doneJobs)}</span><span class="metric-unit">${esc(t('daily-report.metric.printed'))}</span></div>
          <div class="metric-block"><span class="metric-big">${esc(report.print.abortedJobs + report.print.deletedJobs)}</span><span class="metric-unit">${esc(t('daily-report.metric.failed'))}</span></div>
          <div class="metric-block"><span class="metric-big">${esc(report.pipeline.receivedToday)}</span><span class="metric-unit">${esc(t('daily-report.metric.received'))}</span></div>
          <div class="metric-block"><span class="metric-big">${esc(report.pipeline.waiting)}</span><span class="metric-unit">${esc(t('daily-report.metric.waiting'))}</span></div>
        </div>
        <div class="daily-report-preview-tabs">
          <div class="pp-section-label">${esc(t('daily-report.preview.text'))}</div>
          <textarea id="daily-report-text" readonly>${esc(report.email.text || '')}</textarea>
        </div>
        <details class="daily-report-html-preview">
          <summary>${esc(t('daily-report.preview.html'))}</summary>
          <div class="daily-report-html-content">${report.email.html || ''}</div>
        </details>
      </div>
      <div class="modal-footer daily-report-actions">
        <button class="btn-secondary" type="button" id="daily-report-copy-text">${esc(t('daily-report.copy-text'))}</button>
        <a class="btn-secondary" id="daily-report-mailto" href="${esc(mailtoHref(report.email))}">${esc(t('daily-report.open-mail'))}</a>
        <button class="btn-secondary" type="button" id="daily-report-copy-html">${esc(t('daily-report.copy-html'))}</button>
      </div>
    </div>`;
    document.body.appendChild(host);

    host.querySelectorAll('[data-daily-report-close="true"]').forEach((button) => {
      button.addEventListener('click', closeModal);
    });
    host.addEventListener('click', (event) => {
      if (event.target === host) closeModal();
    });
    host.querySelector('#daily-report-copy-text')?.addEventListener('click', () => {
      copyText(report.email.text, t('daily-report.toast.copied'));
    });
    host.querySelector('#daily-report-copy-html')?.addEventListener('click', () => {
      copyText(report.email.html, t('daily-report.toast.html-copied'));
    });
    host.querySelector('#daily-report-reload')?.addEventListener('click', () => {
      loadAndShowReport(host.querySelector('#daily-report-date-input')?.value || report.date);
    });
  }

  function errorMessage(error) {
    const message = error && error.message ? error.message : String(error || '');
    if (typeof Auth.postPurchaseErrorMessage === 'function') return Auth.postPurchaseErrorMessage(error);
    return message || t('daily-report.error.load');
  }

  async function loadAndShowReport(date) {
    const button = document.getElementById('daily-report-btn');
    if (button) {
      button.disabled = true;
      button.dataset.originalText = button.dataset.originalText || button.textContent || '';
      button.textContent = t('daily-report.loading');
    }
    try {
      const report = await Api.loadDailyReport({
        fetchImpl: Auth.appFetch,
        headers: Auth.postPurchaseHeaders(),
        date: date || todayInputValue(),
      });
      renderModal(report);
    } catch (error) {
      console.error('Daily report load failed', error);
      toast(errorMessage(error), 'error');
    } finally {
      if (button) {
        button.disabled = false;
        button.textContent = button.dataset.originalText || t('daily-report.button');
      }
    }
  }

  function initDailyReportUI() {
    const dateInput = document.getElementById('daily-report-date');
    if (dateInput && !dateInput.value) dateInput.value = todayInputValue();
    document.getElementById('daily-report-btn')?.addEventListener('click', () => {
      loadAndShowReport(dateInput?.value || todayInputValue());
    });
  }

  window.PrintGuardDailyReportUI = {
    initDailyReportUI,
    loadAndShowReport,
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initDailyReportUI);
  } else {
    initDailyReportUI();
  }
})();
