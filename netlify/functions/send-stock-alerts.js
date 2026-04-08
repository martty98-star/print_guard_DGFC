const { Client } = require("pg");
const webPush = require("web-push");
const notificationRules = require("../../reports/notification-rules.js");

function json(statusCode, body, extraHeaders) {
  return {
    statusCode,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...extraHeaders,
    },
    body: JSON.stringify(body),
  };
}

function parseRequestBody(event) {
  if (!event || event.body == null || event.body === "") {
    return {};
  }

  if (typeof event.body === "object") {
    return event.body;
  }

  const rawBody = event.isBase64Encoded
    ? Buffer.from(event.body, "base64").toString("utf8")
    : event.body;

  return JSON.parse(rawBody);
}

function isValidVapidSubject(value) {
  return typeof value === "string" && /^(mailto:|https:\/\/)/i.test(value);
}

function getStatusCode(error) {
  const value = error && (error.statusCode || error.status || error.code);
  const code = Number(value);
  return Number.isFinite(code) ? code : null;
}

function normalizeAlertTypes(value) {
  if (Array.isArray(value)) {
    return value
      .filter((item) => typeof item === "string" && item.trim())
      .map((item) => item.trim().toLowerCase());
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      return [];
    }

    try {
      const parsed = JSON.parse(trimmed);
      return normalizeAlertTypes(parsed);
    } catch (error) {
      return [trimmed.toLowerCase()];
    }
  }

  return [];
}

function subscriptionMatchesAlertType(subscription, alertType) {
  const types = normalizeAlertTypes(subscription.alert_types);
  if (!types.length) {
    return true;
  }

  return types.includes("all") || types.includes(String(alertType || "").toLowerCase());
}

async function ensureNotificationStateTable(client) {
  await client.query(
    `
      create table if not exists push_notification_state (
        event_key text primary key,
        category text not null,
        event_type text not null,
        article_number text,
        payload jsonb not null default '{}'::jsonb,
        is_active boolean not null default true,
        first_sent_at timestamptz not null default now(),
        last_sent_at timestamptz not null default now(),
        resolved_at timestamptz null,
        updated_at timestamptz not null default now()
      )
    `
  );
}

async function sendAlertToSubscriptions(client, subscriptions, payload) {
  let attemptedNotifications = 0;
  let deliveriesSent = 0;
  let deliveriesFailed = 0;

  for (const subscription of subscriptions) {
    attemptedNotifications += 1;

    try {
      await webPush.sendNotification(
        {
          endpoint: subscription.endpoint,
          keys: {
            p256dh: subscription.p256dh,
            auth: subscription.auth,
          },
        },
        JSON.stringify(payload)
      );

      deliveriesSent += 1;

      await client.query(
        `
          update push_subscriptions
          set last_push_at = now()
          where endpoint = $1
        `,
        [subscription.endpoint]
      );
    } catch (error) {
      deliveriesFailed += 1;

      const statusCode = getStatusCode(error);
      if (statusCode === 404 || statusCode === 410) {
        try {
          await client.query(
            `
              update push_subscriptions
              set is_active = false,
                  updated_at = now()
              where endpoint = $1
            `,
            [subscription.endpoint]
          );
        } catch (updateError) {
          console.error("Failed to deactivate expired subscription", {
            endpoint: subscription.endpoint,
            error: updateError,
          });
        }
      }

      console.error("Failed to deliver stock alert", {
        subscriptionId: subscription.id,
        endpoint: subscription.endpoint,
        statusCode,
        error: error && error.message ? error.message : String(error),
      });
    }
  }

  return { attemptedNotifications, deliveriesSent, deliveriesFailed };
}

exports.handler = async function handler(event) {
  if (event.httpMethod !== "POST") {
    return json(
      405,
      { ok: false, error: "Method not allowed" },
      { allow: "POST" }
    );
  }

  const connectionString = typeof process.env.NEON_DATABASE_URL === "string"
    ? process.env.NEON_DATABASE_URL.trim()
    : "";
  const vapidPublicKey = typeof process.env.VAPID_PUBLIC_KEY === "string"
    ? process.env.VAPID_PUBLIC_KEY.trim()
    : "";
  const vapidPrivateKey = typeof process.env.VAPID_PRIVATE_KEY === "string"
    ? process.env.VAPID_PRIVATE_KEY.trim()
    : "";
  const vapidSubject = typeof process.env.VAPID_SUBJECT === "string"
    ? process.env.VAPID_SUBJECT.trim()
    : "";

  if (!connectionString || !vapidPublicKey || !vapidPrivateKey || !vapidSubject) {
    return json(500, { ok: false, error: "Missing push configuration" });
  }

  if (!isValidVapidSubject(vapidSubject)) {
    return json(500, { ok: false, error: "Invalid VAPID_SUBJECT" });
  }

  try {
    webPush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);
  } catch (error) {
    return json(500, {
      ok: false,
      error: error && error.message ? error.message : "Invalid VAPID configuration",
    });
  }

  let payload;
  try {
    payload = parseRequestBody(event);
  } catch (error) {
    return json(400, { ok: false, error: "Invalid JSON body" });
  }

  const weeksN = Math.max(1, Number(payload.weeksN) || 8);
  const trigger = typeof payload.trigger === "string" && payload.trigger.trim()
    ? payload.trigger.trim()
    : "manual";

  const client = new Client({
    connectionString,
    ssl: { rejectUnauthorized: false },
  });

  try {
    await client.connect();
    await ensureNotificationStateTable(client);

    const items = (await client.query("select data from public.pg_items")).rows
      .map((row) => row.data)
      .filter(Boolean);
    const movements = (await client.query("select data from public.pg_movements order by timestamp asc")).rows
      .map((row) => row.data)
      .filter(Boolean);

    const candidates = notificationRules.buildStockNotificationCandidates(
      items,
      movements,
      { weeksN },
      new Date()
    );

    console.log("Stock notification candidates loaded", {
      loadedItems: items.length,
      loadedMovements: movements.length,
      candidates: candidates.length,
    });
    candidates.forEach((candidate) => {
      console.log("Stock notification candidate", { eventKey: candidate.dedupeKey, type: candidate.type });
    });

    const activeStateRows = (await client.query(
      `
        select event_key, is_active
        from push_notification_state
        where category = 'stock'
      `
    )).rows;

    const activeStateByKey = new Map(activeStateRows.map((row) => [row.event_key, row]));
    const candidateKeys = new Set(
      candidates.map((candidate) => candidate && candidate.dedupeKey).filter(Boolean)
    );

    let resolvedAlerts = 0;
    for (const row of activeStateRows) {
      if (row.is_active && !candidateKeys.has(row.event_key)) {
        await client.query(
          `
            update push_notification_state
            set is_active = false,
                resolved_at = now(),
                updated_at = now()
            where event_key = $1
          `,
          [row.event_key]
        );
        resolvedAlerts += 1;
      }
    }

    const subscriptions = (await client.query(
      `
        select id, endpoint, p256dh, auth, device_name, alert_types
        from push_subscriptions
        where is_active = true
      `
    )).rows;

    const stockSubscriptions = subscriptions.filter((subscription) =>
      subscriptionMatchesAlertType(subscription, "stock")
    );

    console.log("Stock notification subscriptions matched", {
      matchedSubscriptions: stockSubscriptions.length,
    });

    let sentAlerts = 0;
    let skippedAlerts = 0;
    let attemptedNotifications = 0;
    let deliveriesSent = 0;
    let deliveriesFailed = 0;

    for (const candidate of candidates) {
      const eventKey = candidate.dedupeKey;
      const articleNumber = candidate.metadata && candidate.metadata.articleNumber
        ? candidate.metadata.articleNumber
        : null;

      if (!eventKey) {
        continue;
      }

      const existing = activeStateByKey.get(eventKey);

      if (existing && existing.is_active) {
        skippedAlerts += 1;
        console.log("Skipping active stock notification state", {
          eventKey,
          reason: "already_active",
        });
        await client.query(
          `
            update push_notification_state
            set payload = $2::jsonb,
                updated_at = now()
            where event_key = $1
          `,
          [eventKey, JSON.stringify(candidate)]
        );
        continue;
      }

      console.log("Attempting stock notification delivery", {
        eventKey,
        matchedSubscriptions: stockSubscriptions.length,
        stateWrite: "pending_until_success",
      });

      const deliveryResult = await sendAlertToSubscriptions(client, stockSubscriptions, {
        title: candidate.title,
        body: candidate.body,
        url: candidate.url,
      });

      attemptedNotifications += deliveryResult.attemptedNotifications;
      deliveriesSent += deliveryResult.deliveriesSent;
      deliveriesFailed += deliveryResult.deliveriesFailed;

      console.log("Stock notification delivery result", {
        eventKey,
        attemptedNotifications: deliveryResult.attemptedNotifications,
        sent: deliveryResult.deliveriesSent,
        failed: deliveryResult.deliveriesFailed,
      });

      if (deliveryResult.deliveriesSent <= 0) {
        console.log("Stock notification state not marked as sent", {
          eventKey,
          reason: stockSubscriptions.length === 0 ? "no_matched_subscriptions" : "no_successful_delivery",
          stateWrite: "skipped",
        });
        continue;
      }

      sentAlerts += 1;

      console.log("Writing stock notification state after successful delivery", {
        eventKey,
        stateWrite: "insert_or_update_after_success",
      });

      await client.query(
        `
          insert into push_notification_state (
            event_key,
            category,
            event_type,
            article_number,
            payload,
            is_active,
            first_sent_at,
            last_sent_at,
            resolved_at,
            updated_at
          )
          values (
            $1,
            $2,
            $3,
            $4,
            $5::jsonb,
            true,
            now(),
            now(),
            null,
            now()
          )
          on conflict (event_key) do update
          set
            category = excluded.category,
            event_type = excluded.event_type,
            article_number = excluded.article_number,
            payload = excluded.payload,
            is_active = true,
            last_sent_at = now(),
            resolved_at = null,
            updated_at = now()
        `,
        [
          eventKey,
          candidate.category,
          candidate.type,
          articleNumber,
          JSON.stringify(candidate),
        ]
      );
    }

    console.log("Stock notifications evaluated", {
      loadedItems: items.length,
      loadedMovements: movements.length,
      candidates: candidates.length,
      matchedSubscriptions: stockSubscriptions.length,
      attemptedNotifications,
      sent: deliveriesSent,
      failed: deliveriesFailed,
      skippedActive: skippedAlerts,
      deliveriesSent,
      deliveriesFailed,
    });

    return json(200, {
      ok: true,
      loadedItems: items.length,
      loadedMovements: movements.length,
      candidates: candidates.length,
      matchedSubscriptions: stockSubscriptions.length,
      attemptedNotifications,
      sent: deliveriesSent,
      failed: deliveriesFailed,
      skippedActive: skippedAlerts,
      sentAlerts,
      skippedAlerts,
      resolvedAlerts,
      deliveriesSent,
      deliveriesFailed,
    });
  } catch (error) {
    console.error("send-stock-alerts failed", error);
    return json(500, {
      ok: false,
      error: error && error.message ? error.message : "send-stock-alerts failed",
    });
  } finally {
    try {
      await client.end();
    } catch (error) {
      console.error("send-stock-alerts cleanup failed", error);
    }
  }
};
