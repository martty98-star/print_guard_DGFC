const { Client } = require("pg");

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

function loadWebPush() {
  try {
    return require("web-push");
  } catch (error) {
    console.error("Failed to load web-push", error);
    return null;
  }
}

function getStatusCode(error) {
  const value = error && (error.statusCode || error.status || error.code);
  const code = Number(value);
  return Number.isFinite(code) ? code : null;
}

function isValidVapidSubject(value) {
  return typeof value === "string" && /^(mailto:|https:\/\/)/i.test(value);
}

function getEndpointSuffix(endpoint) {
  if (typeof endpoint !== "string" || endpoint.length === 0) {
    return "";
  }

  return endpoint.slice(-24);
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

  console.log("Push config presence", {
    hasDatabaseUrl: Boolean(connectionString),
    hasVapidPublicKey: Boolean(vapidPublicKey),
    hasVapidPrivateKey: Boolean(vapidPrivateKey),
    hasVapidSubject: Boolean(vapidSubject),
    vapidPublicKeyPrefix: vapidPublicKey ? vapidPublicKey.slice(0, 12) : "",
    vapidPublicKeyLength: vapidPublicKey.length,
    vapidSubject,
  });

  if (!connectionString || !vapidPublicKey || !vapidPrivateKey || !vapidSubject) {
    console.error("Missing push configuration");
    return json(500, { ok: false, error: "Missing push configuration" });
  }

  if (!isValidVapidSubject(vapidSubject)) {
    console.error("Invalid VAPID_SUBJECT", { vapidSubject });
    return json(500, { ok: false, error: "Invalid VAPID_SUBJECT" });
  }

  const webPush = loadWebPush();
  if (!webPush) {
    return json(500, { ok: false, error: "Internal server error" });
  }

  try {
    webPush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);
  } catch (error) {
    console.error("Invalid VAPID configuration", error);
    return json(500, {
      ok: false,
      error: error && error.message ? error.message : "Invalid VAPID configuration",
    });
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
        select id, endpoint, p256dh, auth, device_name
        from push_subscriptions
        where is_active = true
      `
    );

    const payload = JSON.stringify({
      title: "PrintGuard test",
      body: "Push notifikace fungují.",
      url: "/",
    });

    for (const row of result.rows) {
      console.log("Sending test push", {
        id: row.id,
        deviceName: row.device_name || null,
        endpointSuffix: getEndpointSuffix(row.endpoint),
      });

      const subscription = {
        endpoint: row.endpoint,
        keys: {
          p256dh: row.p256dh,
          auth: row.auth,
        },
      };

      try {
        await webPush.sendNotification(subscription, payload);
        sent += 1;

        console.log("Test push sent", {
          id: row.id,
          deviceName: row.device_name || null,
          endpointSuffix: getEndpointSuffix(row.endpoint),
        });

        await client.query(
          `
            update push_subscriptions
            set last_push_at = now()
            where endpoint = $1
          `,
          [row.endpoint]
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
              [row.endpoint]
            );
          } catch (updateError) {
            console.error("Failed to deactivate subscription", {
              endpoint: row.endpoint,
              error: updateError,
            });
          }
        }

        console.error("Failed to send push notification", {
          id: row.id,
          deviceName: row.device_name || null,
          endpoint: row.endpoint,
          endpointSuffix: getEndpointSuffix(row.endpoint),
          statusCode,
          error: error && error.message ? error.message : String(error),
        });
      }
    }

    return json(200, { ok: true, sent, failed });
  } catch (error) {
    console.error("send-test-push failed", error);
    return json(500, {
      ok: false,
      error: error && error.message ? error.message : "send-test-push failed",
    });
  } finally {
    try {
      await client.end();
    } catch (error) {
      console.error("send-test-push cleanup failed", error);
    }
  }
};
