(function attachPrintGuardExportUtils(global) {
  'use strict';

  const Reports = global.PrintGuardReports || {};

  function csvEsc(value) {
    return Reports.csv.csvEsc(value);
  }

  function csvRow(values) {
    return Reports.csv.csvRow(values);
  }

  function fmtFileDT() {
    const d = new Date();
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}`;
  }

  function fmtExportDateTime(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (!Number.isFinite(d.getTime())) return String(iso);
    return d.toLocaleString('cs-CZ', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  }

  function dlBlob(content, type, filename) {
    const blob = new Blob(['\ufeff' + content], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(url);
      a.remove();
    }, 500);
  }

  global.PrintGuardExportUtils = {
    csvEsc,
    csvRow,
    dlBlob,
    fmtExportDateTime,
    fmtFileDT,
  };
})(window);
