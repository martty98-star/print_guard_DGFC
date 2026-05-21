const { Client } = require('pg');

function getConnectionString() {
  const conn = process.env.NEON_DATABASE_URL || process.env.DATABASE_URL || '';
  const value = String(conn || '').trim();
  if (!value) {
    throw new Error('Missing NEON_DATABASE_URL or DATABASE_URL');
  }
  return value;
}

function getRecordId() {
  const id = String(process.argv[2] || '').trim();
  if (!id) {
    throw new Error('Usage: node scripts/cleanup-colorado-record.js <record-id>');
  }
  return id;
}

async function main() {
  const recordId = getRecordId();
  const connectionString = getConnectionString();
  const client = new Client({
    connectionString,
    ssl: { rejectUnauthorized: false },
  });

  try {
    await client.connect();
    const existing = await client.query(
      'select data, updated_at from public.pg_co_records where id = $1',
      [recordId],
    );

    if (!existing.rowCount) {
      console.log(`[cleanup] record not found: ${recordId}`);
      return;
    }

    const row = existing.rows[0] || {};
    const current = row.data || {};
    const now = new Date().toISOString();
    const tombstone = {
      ...current,
      deletedAt: now,
      updatedAt: now,
    };

    await client.query(
      `insert into public.pg_co_records(id, machine_id, timestamp, data, updated_at)
       values ($1, $2, $3, $4::jsonb, $5::timestamptz)
       on conflict (id) do update
       set data = excluded.data,
           updated_at = excluded.updated_at`,
      [
        recordId,
        current.machineId || '',
        current.timestamp || now,
        JSON.stringify(tombstone),
        now,
      ]
    );

    console.log(`[cleanup] tombstoned record: ${recordId}`);
  } catch (error) {
    console.error(`[cleanup] failed: ${error && error.message ? error.message : error}`);
    process.exitCode = 1;
  } finally {
    try {
      await client.end();
    } catch (_) {}
  }
}

main();
