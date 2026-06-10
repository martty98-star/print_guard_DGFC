/* PrintGuard — push notification helpers (loaded before app.js) */
'use strict';

(function attachPrintGuardPush(global) {
  function createPush(deps) {
    const {
      Reports,
      buildPushSubscriptionPayload,
      cfg,
      getPushDeviceName,
      getPushEndpointSuffix,
      persistPushSubscription,
      showToast,
      urlBase64ToUint8Array,
    } = deps;

    async function enablePushNotifications() {
      try {
        if (!('serviceWorker' in navigator)) {
          showToast('Service Worker není podporován.', 'error');
          return;
        }
        if (!('PushManager' in global) || !('Notification' in global)) {
          showToast('Push notifikace nejsou podporovány.', 'error');
          return;
        }
        const vapidPublicKey =
          typeof global.VAPID_PUBLIC_KEY === 'string'
            ? global.VAPID_PUBLIC_KEY.trim()
            : '';
        if (!vapidPublicKey) {
          showToast('Chybí VAPID public key.', 'error');
          return;
        }
        console.log('[Push] VAPID_PUBLIC_KEY presence', {
          exists: Boolean(global.VAPID_PUBLIC_KEY),
          length: vapidPublicKey.length,
        });
        const permission = await global.Notification.requestPermission();
        if (permission !== 'granted') {
          showToast('Push notifikace nebyly povoleny.', 'error');
          return;
        }
        const registration = await navigator.serviceWorker.ready;
        let subscription = await registration.pushManager.getSubscription();
        const deviceName = getPushDeviceName();
        console.log('[Push] subscribe start', {
          deviceName,
          hasExistingSubscription: Boolean(subscription),
          endpointSuffix: getPushEndpointSuffix(
            subscription && typeof subscription.endpoint === 'string'
              ? subscription.endpoint
              : '',
          ),
        });
        if (subscription) {
          const existingPayload = buildPushSubscriptionPayload(subscription);
          if (existingPayload) {
            console.log('[Push] reusing existing subscription', {
              deviceName,
              endpointSuffix: getPushEndpointSuffix(existingPayload.endpoint),
            });
            await persistPushSubscription(existingPayload);
            showToast('Push notifikace byly povoleny.', 'success');
            return;
          }
          try {
            console.warn('[Push] unsubscribing stale subscription', {
              deviceName,
              endpointSuffix: getPushEndpointSuffix(subscription.endpoint),
            });
            await subscription.unsubscribe();
          } catch (error) {
            console.warn(
              '[Push] failed to unsubscribe stale subscription',
              error,
            );
          }
          subscription = null;
        }
        if (!subscription) {
          const applicationServerKey = urlBase64ToUint8Array(vapidPublicKey);
          if (applicationServerKey.length !== 65)
            throw new Error('VAPID public key has invalid length.');
          subscription = await registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey,
          });
          console.log('[Push] created new subscription', {
            deviceName,
            endpointSuffix: getPushEndpointSuffix(subscription.endpoint),
          });
        }
        const payload = buildPushSubscriptionPayload(subscription);
        if (!payload) throw new Error('Neplatná push subscription.');
        await persistPushSubscription(payload);
        showToast('Push notifikace byly povoleny.', 'success');
      } catch (error) {
        console.error('[Push] enable failed', error);
        showToast('Zapnutí push notifikací selhalo.', 'error');
      }
    }

    async function sendStockNotifications(options = {}) {
      const { silent = false, trigger = 'manual' } = options;
      if (
        !Reports.notificationDispatch ||
        typeof Reports.notificationDispatch.evaluateStockAlerts !== 'function'
      ) {
        if (!silent) showToast('Chybí notification dispatch modul.', 'error');
        return null;
      }
      try {
        const result = await Reports.notificationDispatch.evaluateStockAlerts({
          weeksN: cfg.weeksN,
          trigger,
        });
        if (!silent) {
          showToast(
            `Stock notifikace: nové ${result.sentAlerts || 0}, beze změny ${result.skippedAlerts || 0}.`,
            'success',
          );
        }
        return result;
      } catch (error) {
        console.error('[Push] stock notifications failed', error);
        if (!silent)
          showToast(
            error?.message || 'Odeslání stock notifikací selhalo.',
            'error',
          );
        return null;
      }
    }

    return { enablePushNotifications, sendStockNotifications };
  }

  global.PrintGuardPush = { createPush };
})(window);
