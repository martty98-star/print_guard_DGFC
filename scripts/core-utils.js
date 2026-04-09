'use strict';

(() => {
  function genId(prefix = 'id') {
    return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  }

  function getNullableNumber(v) {
    if (v === null || v === undefined || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }

  function esc(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function fmtN(n, dec = 1) {
    if (n === null || n === undefined || isNaN(n)) return '—';
    return Number(n).toFixed(dec);
  }

  function fmtInt(n) {
    if (n === null || n === undefined || isNaN(n)) return '0';
    return String(Math.round(Number(n)));
  }

  function fmtMeasure(n, unit, dec = 1) {
    if (n === null || n === undefined || isNaN(n)) return '—';
    return `${Number(n).toFixed(dec)} ${unit}`;
  }

  function fmtDuration(totalSec) {
    const sec = Math.max(0, Number(totalSec) || 0);
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`;
    return `${m}m`;
  }

  function fmtDurationSeconds(totalSec) {
    const sec = Math.max(0, Number(totalSec) || 0);
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = Math.floor(sec % 60);
    if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    return `${m}:${String(s).padStart(2, '0')}`;
  }

  function fmtDays(d) {
    if (d >= 999) return '∞';
    if (d <= 0) return '0 dní';
    if (d < 14) return `${Math.round(d)} dní`;
    if (d < 60) return `${Math.round(d / 7)} týdnů`;
    return `${Math.round(d / 30)} měs.`;
  }

  function fmtDT(iso) {
    if (!iso) return '—';
    return new Date(iso).toLocaleString('cs-CZ', {
      day: '2-digit',
      month: '2-digit',
      year: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  function toLocalDT(iso) {
    const d = new Date(iso);
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
  }

  function toISOfromDT(v) {
    return v ? new Date(v).toISOString() : new Date().toISOString();
  }

  function ds() {
    return new Date().toISOString().slice(0, 10);
  }

  window.PrintGuardCoreUtils = {
    ds,
    esc,
    fmtDays,
    fmtDT,
    fmtDuration,
    fmtDurationSeconds,
    fmtInt,
    fmtMeasure,
    fmtN,
    genId,
    getNullableNumber,
    toISOfromDT,
    toLocalDT,
  };
})();
