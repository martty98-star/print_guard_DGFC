/* PrintGuard — service worker update helpers (loaded before app.js) */
'use strict';

(function attachPrintGuardAppUpdates(global) {
  const AppConfig = global.PrintGuardAppConfig;
  const DomUtils = global.PrintGuardDomUtils;

  if (!AppConfig) throw new Error('Missing PrintGuardAppConfig');
  if (!DomUtils) throw new Error('Missing PrintGuardDomUtils');

  const { APP_VERSION } = AppConfig;
  const { showToast } = DomUtils;

  function showPendingUpdateToast() {
    if (sessionStorage.getItem('pg_sw_updated') === '1') {
      sessionStorage.removeItem('pg_sw_updated');
      const message = `Nová verze aplikace byla načtena (${APP_VERSION})`;
      showToast(message, 'success');
      if (
        'Notification' in global &&
        global.Notification.permission === 'granted'
      ) {
        try {
          new global.Notification('PrintGuard update', {
            body: message,
            icon: '/icons/icon-192.png',
          });
        } catch (_) {}
      }
    }
  }

  function setupAppUpdateChecks() {
    if (!('serviceWorker' in navigator)) {
      return;
    }

    navigator.serviceWorker.addEventListener('controllerchange', () => {
      sessionStorage.setItem('pg_sw_updated', '1');
      global.location.reload();
    });

    const requestUpdate = () => {
      navigator.serviceWorker
        .getRegistration()
        .then((registration) => {
          if (registration) {
            registration.update().catch(() => {});
          }
        })
        .catch(() => {});
    };

    global.addEventListener('focus', requestUpdate);
    global.addEventListener('online', requestUpdate);
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) {
        requestUpdate();
      }
    });

    requestUpdate();
  }

  global.PrintGuardAppUpdates = {
    showPendingUpdateToast,
    setupAppUpdateChecks,
  };
})(window);
