(function attachPrintGuardPushUtils(global) {
  'use strict';

  function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const rawData = atob(base64);
    const outputArray = new Uint8Array(rawData.length);

    for (let i = 0; i < rawData.length; i += 1) {
      outputArray[i] = rawData.charCodeAt(i);
    }

    return outputArray;
  }

  function getPushDeviceName() {
    const ua = navigator.userAgent || '';

    if (/android/i.test(ua)) return 'Android';
    if (/iphone|ipad|ipod/i.test(ua)) return 'iPhone';
    if (/windows/i.test(ua)) return 'Windows';
    if (/mac os x/i.test(ua)) return 'Mac';
    if (/linux/i.test(ua)) return 'Linux';

    return 'Unknown device';
  }

  function getPushEndpointSuffix(endpoint) {
    return typeof endpoint === 'string' && endpoint.length > 24
      ? endpoint.slice(-24)
      : (typeof endpoint === 'string' ? endpoint : '');
  }

  function buildPushSubscriptionPayload(subscription) {
    const subJson = subscription && typeof subscription.toJSON === 'function'
      ? subscription.toJSON()
      : null;

    const endpoint = typeof subJson?.endpoint === 'string' ? subJson.endpoint.trim() : '';
    const p256dh = typeof subJson?.keys?.p256dh === 'string' ? subJson.keys.p256dh.trim() : '';
    const auth = typeof subJson?.keys?.auth === 'string' ? subJson.keys.auth.trim() : '';

    if (!endpoint || !p256dh || !auth) {
      return null;
    }

    return {
      endpoint,
      keys: {
        p256dh,
        auth,
      },
      deviceName: getPushDeviceName(),
      userLabel: 'Martin',
      alertTypes: ['all'],
    };
  }

  async function persistPushSubscription(payload) {
    console.log('[Push] persist subscription', {
      deviceName: payload?.deviceName || null,
      endpointSuffix: getPushEndpointSuffix(payload?.endpoint),
    });

    const res = await fetch('/.netlify/functions/save-subscription', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    let result = null;
    try { result = await res.json(); } catch (_) {}

    if (!res.ok || !result?.ok) {
      throw new Error(result?.error || 'Uložení odběru selhalo.');
    }

    return result;
  }

  function runNotificationDispatch(task, label) {
    if (!task || typeof task.then !== 'function') {
      return;
    }

    task.catch((error) => {
      console.error(`[Push] ${label || 'notification dispatch'} failed`, error);
    });
  }

  global.PrintGuardPushUtils = {
    buildPushSubscriptionPayload,
    getPushDeviceName,
    persistPushSubscription,
    runNotificationDispatch,
    urlBase64ToUint8Array,
  };
})(window);
