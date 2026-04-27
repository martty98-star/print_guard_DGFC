// netlify/functions/sync.js
import pg from "pg";
const { Client } = pg;

function getAdminPin() {
  const value =
    process.env.PRINTGUARD_ADMIN_PIN ||
    process.env.NETLIFY_PRINTGUARD_ADMIN_PIN ||
    process.env.PG_ADMIN_PIN ||
    "";
  return typeof value === "string" ? value.trim() : "";
}

function getHeader(event, name) {
  if (!event || !event.headers) return "";
  const lower = String(name || "").toLowerCase();
  for (const [key, value] of Object.entries(event.headers)) {
    if (String(key).toLowerCase() === lower) {
      return typeof value === "string" ? value.trim() : "";
    }
  }
  return "";
}

function resp(statusCode, body) {
  return {
    statusCode,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
    body: JSON.stringify(body),
  };
}

function chunkArray(values, size) {
  const chunks = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}

async function batchUpsertItems(client, items) {
  const valid = items.filter((item) => item?.articleNumber);
  for (const chunk of chunkArray(valid, 500)) {
    const params = [];
    const valuesSql = chunk.map((item, index) => {
      const base = index * 2;
      params.push(item.articleNumber, JSON.stringify(item));
      return `($${base + 1}, $${base + 2}::jsonb, now())`;
    }).join(",");

    await client.query(
      `insert into public.pg_items(article_number, data, updated_at)
       values ${valuesSql}
       on conflict (article_number) do update
       set data = excluded.data, updated_at = now()`,
      params
    );
  }
  return valid.length;
}

async function batchUpsertMovements(client, movements) {
  const valid = movements.filter((movement) => movement?.id);
  for (const chunk of chunkArray(valid, 300)) {
    const params = [];
    const valuesSql = chunk.map((movement, index) => {
      const base = index * 4;
      params.push(
        movement.id,
        movement.articleNumber || "",
        movement.timestamp || new Date().toISOString(),
        JSON.stringify(movement)
      );
      return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}::jsonb, now())`;
    }).join(",");

    await client.query(
      `insert into public.pg_movements(id, article_number, timestamp, data, updated_at)
       values ${valuesSql}
       on conflict (id) do update
       set data = excluded.data, updated_at = now()`,
      params
    );
  }
  return valid.length;
}

async function batchUpsertCoRecords(client, coRecords) {
  const valid = coRecords.filter((record) => record?.id);
  for (const chunk of chunkArray(valid, 300)) {
    const params = [];
    const valuesSql = chunk.map((record, index) => {
      const base = index * 4;
      params.push(
        record.id,
        record.machineId || "",
        record.timestamp || new Date().toISOString(),
        JSON.stringify(record)
      );
      return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}::jsonb, now())`;
    }).join(",");

    await client.query(
      `insert into public.pg_co_records(id, machine_id, timestamp, data, updated_at)
       values ${valuesSql}
       on conflict (id) do update
       set data = excluded.data, updated_at = now()`,
      params
    );
  }
  return valid.length;
}

export async function handler(event) {
  const conn = process.env.NETLIFY_DATABASE_URL || process.env.DATABASE_URL;
  if (!conn) return resp(500, { ok: false, error: "Missing NETLIFY_DATABASE_URL" });

  const client = new Client({
    connectionString: conn,
    ssl: { rejectUnauthorized: false },
  });

  try {
    await client.connect();

    // ---------- GET = pull ----------
    if (event.httpMethod === "GET") {
      const items = (await client.query("select data from public.pg_items")).rows.map(r => r.data);
      const movements = (await client.query("select data from public.pg_movements order by timestamp asc")).rows.map(r => r.data);
      const coRecords = (await client.query("select data from public.pg_co_records order by timestamp asc")).rows.map(r => r.data);

      return resp(200, { ok: true, items, movements, coRecords });
    }

    // ---------- POST = push ----------
    if (event.httpMethod === "POST") {
      const payload = JSON.parse(event.body || "{}");
      const items = Array.isArray(payload.items) ? payload.items : [];
      const movements = Array.isArray(payload.movements) ? payload.movements : [];
      const coRecords = Array.isArray(payload.coRecords) ? payload.coRecords : [];

      await client.query("begin");

      const upsertedItems = await batchUpsertItems(client, items);
      const upsertedMovements = await batchUpsertMovements(client, movements);
      const upsertedCoRecords = await batchUpsertCoRecords(client, coRecords);

      await client.query("commit");
      return resp(200, {
        ok: true,
        upserted: { items: upsertedItems, movements: upsertedMovements, coRecords: upsertedCoRecords },
      });
    }

    // ---------- DELETE = hard delete ----------
    if (event.httpMethod === "DELETE") {
      const expectedPin = getAdminPin();
      const providedPin = getHeader(event, "x-printguard-admin-pin");
      if (!expectedPin) return resp(500, { ok: false, error: "Missing admin PIN configuration" });
      if (!providedPin || providedPin !== expectedPin) {
        return resp(403, { ok: false, error: "Forbidden" });
      }

      const query = event.queryStringParameters || {};
      const kind = String(query.kind || "").trim();
      const key = String(query.key || "").trim();

      if (!kind || !key) {
        return resp(400, { ok: false, error: "Missing delete kind/key" });
      }

      await client.query("begin");

      if (kind === "movement") {
        await client.query(`delete from public.pg_movements where id = $1`, [key]);
      } else if (kind === "coRecord") {
        await client.query(`delete from public.pg_co_records where id = $1`, [key]);
      } else if (kind === "item") {
        await client.query(`delete from public.pg_movements where article_number = $1`, [key]);
        await client.query(`delete from public.pg_items where article_number = $1`, [key]);
      } else {
        await client.query("rollback");
        return resp(400, { ok: false, error: `Unsupported delete kind: ${kind}` });
      }

      await client.query("commit");
      return resp(200, { ok: true, deleted: { kind, key } });
    }

    return resp(405, { ok: false, error: "Method not allowed" });
  } catch (e) {
    try { await client.query("rollback"); } catch {}
    return resp(500, { ok: false, error: String(e?.message || e) });
  } finally {
    try { await client.end(); } catch {}
  }
}
