(function attachChecklistState(root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
    return;
  }
  root.PrintGuardChecklistState = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function createChecklistStateModule() {
  'use strict';

  function createState() {
    return {
      applyRoleUI: null,
      cfg: null,
      el: null,
      fetchImpl: null,
      i18n: null,
      initialized: false,
      items: [],
      completions: [],
      loaded: false,
      loading: false,
      editingItemId: null,
      showConfirm: null,
      showToast: null,
    };
  }

  function isAdmin(state) {
    return Boolean(state.cfg && state.cfg.role === 'admin');
  }

  function getActor(state) {
    const userName = state.cfg && state.cfg.userName ? String(state.cfg.userName).trim() : '';
    if (userName) return userName;
    const deviceId = state.cfg && state.cfg.deviceId ? state.cfg.deviceId : 'device';
    const role = state.cfg && state.cfg.role ? state.cfg.role : 'operator';
    return role + ':' + deviceId;
  }

  function t(state, key) {
    if (typeof state.i18n === 'function') return state.i18n(key);
    return key;
  }

  function getDefaultItem() {
    return {
      title: '',
      description: '',
      enabled: true,
      scheduleType: 'weekly',
      daysOfWeek: ['mon', 'tue', 'wed', 'thu', 'fri'],
      dayOfMonth: null,
      timeOfDay: '08:00',
      category: 'maintenance',
      timeZone: 'Europe/Prague',
    };
  }

  function findItemById(state, id) {
    return state.items.find((item) => item.id === id) || null;
  }

  function getEditingItem(state) {
    return findItemById(state, state.editingItemId) || null;
  }

  function getCompletedOccurrenceKeys(state) {
    return new Set((state.completions || []).map((row) => String(row.occurrenceKey || '').trim()).filter(Boolean));
  }

  return {
    createState,
    findItemById,
    getActor,
    getCompletedOccurrenceKeys,
    getDefaultItem,
    getEditingItem,
    isAdmin,
    t,
  };
});
