// netlify/functions/sync.js
import pg from "pg";
const { Client } = pg;

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

      // items: key = articleNumber
      for (const it of items) {
        const article = it?.articleNumber;
        if (!article) continue;

        await client.query(
          `insert into public.pg_items(article_number, data, updated_at)
           values ($1, $2::jsonb, now())
           on conflict (article_number) do update
           set data = excluded.data, updated_at = now()`,
          [article, JSON.stringify(it)]
        );
      }

      // movements: key = id
      for (const m of movements) {
        const id = m?.id;
        if (!id) continue;

        await client.query(
          `insert into public.pg_movements(id, article_number, timestamp, data, updated_at)
           values ($1, $2, $3, $4::jsonb, now())
           on conflict (id) do update
           set data = excluded.data, updated_at = now()`,
          [
            id,
            m.articleNumber || "",
            m.timestamp || new Date().toISOString(),
            JSON.stringify(m),
          ]
        );
      }

      // coRecords: key = id
      for (const r of coRecords) {
        const id = r?.id;
        if (!id) continue;

        await client.query(
          `insert into public.pg_co_records(id, machine_id, timestamp, data, updated_at)
           values ($1, $2, $3, $4::jsonb, now())
           on conflict (id) do update
           set data = excluded.data, updated_at = now()`,
          [
            id,
            r.machineId || "",
            r.timestamp || new Date().toISOString(),
            JSON.stringify(r),
          ]
        );
      }

      await client.query("commit");
      return resp(200, {
        ok: true,
        upserted: { items: items.length, movements: movements.length, coRecords: coRecords.length },
      });
    }

    // ---------- DELETE = hard delete ----------
    if (event.httpMethod === "DELETE") {
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
