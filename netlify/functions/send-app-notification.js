const { Client } = require("pg");
const webPush = require("web-push");

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
      return normalizeAlertTypes(JSON.parse(trimmed));
    } catch (error) {
      return [trimmed.toLowerCase()];
    }
  }

  return [];
}

function subscriptionMatchesCategory(subscription, category) {
  const types = normalizeAlertTypes(subscription.alert_types);
  if (!types.length) {
    return true;
  }

  return types.includes("all") || types.includes(String(category || "").toLowerCase());
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

  const type = typeof payload.type === "string" ? payload.type.trim() : "";
  const category = typeof payload.category === "string" ? payload.category.trim().toLowerCase() : "";
  const title = typeof payload.title === "string" ? payload.title.trim() : "";
  const body = typeof payload.body === "string" ? payload.body.trim() : "";
  const url = typeof payload.url === "string" && payload.url.trim() ? payload.url.trim() : "/";

  if (!type || !category || !title || !body) {
    return json(400, { ok: false, error: "Missing notification event fields" });
  }

  const client = new Client({
    connectionString,
    ssl: { rejectUnauthorized: false },
  });

  let sent = 0;
  let failed = 0;

  try {
    await client.connect();

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

    const notificationPayload = JSON.stringify({ title, body, url });

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
          notificationPayload
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
            console.error("Failed to deactivate subscription", {
              endpoint: subscription.endpoint,
              error: updateError,
            });
          }
        }

        console.error("Failed to send app notification", {
          type,
          category,
          subscriptionId: subscription.id,
          statusCode,
          error: error && error.message ? error.message : String(error),
        });
      }
    }

    return json(200, {
      ok: true,
      matchedSubscriptions: matchedSubscriptions.length,
      sent,
      failed,
    });
  } catch (error) {
    console.error("send-app-notification failed", error);
    return json(500, {
      ok: false,
      error: error && error.message ? error.message : "send-app-notification failed",
    });
  } finally {
    try {
      await client.end();
    } catch (error) {
      console.error("send-app-notification cleanup failed", error);
    }
  }
};
