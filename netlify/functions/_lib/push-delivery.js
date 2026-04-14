'use strict';

const webPush = require('web-push');

let vapidConfigured = false;

function isValidVapidSubject(value) {
  return typeof value === 'string' && /^(mailto:|https:\/\/)/i.test(value);
}

function getStatusCode(error) {
  const value = error && (error.statusCode || error.status || error.code);
  const code = Number(value);
  return Number.isFinite(code) ? code : null;
}

function normalizeAlertTypes(value) {
  if (Array.isArray(value)) {
    return value
      .filter((item) => typeof item === 'string' && item.trim())
      .map((item) => item.trim().toLowerCase());
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) {
      return [];
    }

    try {
      return normalizeAlertTypes(JSON.parse(trimmed));
    } catch (error) {
      return [trimmed.toLowerCase()];
    }
  }

  return [];
}

function subscriptionMatchesCategory(subscription, category) {
  const types = normalizeAlertTypes(subscription && subscription.alert_types);
  if (!types.length) {
    return true;
  }

  return types.includes('all') || types.includes(String(category || '').toLowerCase());
}

function ensureVapidConfigured() {
  if (vapidConfigured) {
    return;
  }

  const publicKey = typeof process.env.VAPID_PUBLIC_KEY === 'string'
    ? process.env.VAPID_PUBLIC_KEY.trim()
    : '';
  const privateKey = typeof process.env.VAPID_PRIVATE_KEY === 'string'
    ? process.env.VAPID_PRIVATE_KEY.trim()
    : '';
  const subject = typeof process.env.VAPID_SUBJECT === 'string'
    ? process.env.VAPID_SUBJECT.trim()
    : '';

  if (!publicKey || !privateKey || !subject) {
    throw new Error('Missing push configuration');
  }

  if (!isValidVapidSubject(subject)) {
    throw new Error('Invalid VAPID_SUBJECT');
  }

  webPush.setVapidDetails(subject, publicKey, privateKey);
  vapidConfigured = true;
}

async function sendPushToMatchingSubscriptions(client, category, notificationPayload) {
  ensureVapidConfigured();

  const result = await client.query(
    `
      select id, endpoint, p256dh, auth, alert_types
      from push_subscriptions
      where is_active = true
    `
  );

  const matchedSubscriptions = result.rows.filter((subscription) =>
    subscriptionMatchesCategory(subscription, category)
  );

  let sent = 0;
  let failed = 0;

  for (const subscription of matchedSubscriptions) {
    try {
      await webPush.sendNotification(
        {
          endpoint: subscription.endpoint,
          keys: {
            p256dh: subscription.p256dh,
            auth: subscription.auth,
          },
        },
        JSON.stringify(notificationPayload)
      );

      sent += 1;

      await client.query(
        `
          update push_subscriptions
          set last_push_at = now()
          where endpoint = $1
        `,
        [subscription.endpoint]
      );
    } catch (error) {
      failed += 1;

      const statusCode = getStatusCode(error);
      if (statusCode === 404 || statusCode === 410) {
        await client.query(
          `
            update push_subscriptions
            set is_active = false,
                updated_at = now()
            where endpoint = $1
          `,
          [subscription.endpoint]
        ).catch(() => {});
      }

      console.error('Checklist push delivery failed', {
        category,
        subscriptionId: subscription.id,
        statusCode,
        error: error && error.message ? error.message : String(error),
      });
    }
  }

  return {
    matchedSubscriptions: matchedSubscriptions.length,
    sent,
    failed,
  };
}

module.exports = {
  ensureVapidConfigured,
  normalizeAlertTypes,
  sendPushToMatchingSubscriptions,
  subscriptionMatchesCategory,
};
