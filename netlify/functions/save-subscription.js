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

function normalizeOptionalString(value) {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

async function getAlertTypesBinding(client, alertTypes) {
  const result = await client.query(
    `
      select data_type, udt_name
      from information_schema.columns
      where table_name = 'push_subscriptions'
        and column_name = 'alert_types'
      order by case when table_schema = current_schema() then 0 else 1 end
      limit 1
    `
  );

  const column = result.rows[0];

  if (!column || column.data_type === "ARRAY") {
    return { sqlValue: "$6", value: alertTypes };
  }

  if (column.data_type === "jsonb") {
    return { sqlValue: "$6::jsonb", value: JSON.stringify(alertTypes) };
  }

  if (column.data_type === "json") {
    return { sqlValue: "$6::json", value: JSON.stringify(alertTypes) };
  }

  return { sqlValue: "$6", value: JSON.stringify(alertTypes) };
}

exports.handler = async function handler(event) {
  if (event.httpMethod !== "POST") {
    return json(
      405,
      { ok: false, error: "Method not allowed" },
      { allow: "POST" }
    );
  }

  const connectionString = process.env.NEON_DATABASE_URL;
  if (!connectionString) {
    console.error("Missing NEON_DATABASE_URL");
    return json(500, { ok: false, error: "Internal server error" });
  }

  let payload;

  try {
    payload = parseRequestBody(event);
  } catch (error) {
    return json(400, { ok: false, error: "Invalid JSON body" });
  }

  const endpoint = typeof payload.endpoint === "string" ? payload.endpoint.trim() : "";
  const p256dh =
    typeof payload?.keys?.p256dh === "string" ? payload.keys.p256dh.trim() : "";
  const auth =
    typeof payload?.keys?.auth === "string" ? payload.keys.auth.trim() : "";

  if (!endpoint || !p256dh || !auth) {
    return json(400, {
      ok: false,
      error: "Missing required fields: endpoint, keys.p256dh, keys.auth",
    });
  }

  const deviceName = normalizeOptionalString(payload.deviceName);
  const userLabel = normalizeOptionalString(payload.userLabel);
  const alertTypes = Array.isArray(payload.alertTypes)
    ? payload.alertTypes.filter((value) => typeof value === "string" && value.trim())
    : ["all"];

  const client = new Client({
    connectionString,
    ssl: { rejectUnauthorized: false },
  });

  try {
    await client.connect();

    const alertTypesBinding = await getAlertTypesBinding(client, alertTypes);

    await client.query(
      `
        insert into push_subscriptions (
          endpoint,
          p256dh,
          auth,
          device_name,
          user_label,
          alert_types,
          is_active,
          created_at,
          updated_at,
          last_seen_at
        )
        values (
          $1,
          $2,
          $3,
          $4,
          $5,
          ${alertTypesBinding.sqlValue},
          true,
          now(),
          now(),
          now()
        )
        on conflict (endpoint) do update
        set
          p256dh = excluded.p256dh,
          auth = excluded.auth,
          device_name = coalesce(excluded.device_name, push_subscriptions.device_name),
          user_label = coalesce(excluded.user_label, push_subscriptions.user_label),
          alert_types = excluded.alert_types,
          is_active = true,
          updated_at = now(),
          last_seen_at = now()
      `,
      [endpoint, p256dh, auth, deviceName, userLabel, alertTypesBinding.value]
    );

    return json(200, { ok: true });
  } catch (error) {
    console.error("save-subscription failed", error);
    return json(500, { ok: false, error: "Internal server error" });
  } finally {
    try {
      await client.end();
    } catch (error) {
      console.error("save-subscription cleanup failed", error);
    }
  }
};
