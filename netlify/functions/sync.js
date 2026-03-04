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
    const r = await client.query("select now() as now, current_database() as db;");
    return resp(200, { ok: true, result: r.rows[0] });
  } catch (e) {
    return resp(500, { ok: false, error: String(e?.message || e) });
  } finally {
    try { await client.end(); } catch {}
  }
}