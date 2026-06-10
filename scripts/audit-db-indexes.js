#!/usr/bin/env node
'use strict';

const { Client } = require('pg');

const TABLES = [
  'processed_print_orders',
  'print_orders_received',
  'processed_order_reprint_requests',
  'print_accounting_rows',
];

const VIEWS = [
  'v_print_order_pipeline',
  'v_print_log_rows',
  'v_print_log_daily',
];

function getConnectionString() {
  const requestedEnv = String(process.env.DB_URL_ENV || '').trim();
  if (requestedEnv) {
    return {
      source: requestedEnv,
      value: String(process.env[requestedEnv] || '').trim(),
    };
  }
  if (process.env.NEON_DATABASE_URL) {
    return {
      source: 'NEON_DATABASE_URL',
      value: String(process.env.NEON_DATABASE_URL).trim(),
    };
  }
  if (process.env.DATABASE_URL) {
    return {
      source: 'DATABASE_URL',
      value: String(process.env.DATABASE_URL).trim(),
    };
  }
  return {
    source: 'NETLIFY_DATABASE_URL',
    value: String(process.env.NETLIFY_DATABASE_URL || '').trim(),
  };
}

function safeConnectionTarget(value) {
  try {
    const url = new URL(value);
    return `${url.username || '(no user)'}@${url.host}${url.pathname}`;
  } catch {
    return '(unparseable URL)';
  }
}

async function main() {
  const selected = getConnectionString();
  const connectionString = selected.value;
  if (!connectionString) {
    throw new Error(
      'Missing database URL. Set NETLIFY_DATABASE_URL, DATABASE_URL, or NEON_DATABASE_URL before running this script.',
    );
  }

  const client = new Client({
    connectionString,
    ssl: { rejectUnauthorized: false },
  });

  console.log('Database index audit');
  console.log('--------------------');
  console.log(`Connection source: ${selected.source}`);
  console.log(`Connection target: ${safeConnectionTarget(connectionString)}`);

  await client.connect();
  try {
    const [extensions, indexes, viewColumns] = await Promise.all([
      client.query(`
        select extname
        from pg_extension
        where extname in ('pg_trgm', 'pgcrypto')
        order by extname
      `),
      client.query(
        `
          select schemaname, tablename, indexname, indexdef
          from pg_indexes
          where schemaname = 'public'
            and tablename = any($1::text[])
          order by tablename, indexname
        `,
        [TABLES],
      ),
      client.query(
        `
        select table_name, column_name, data_type
        from information_schema.columns
        where table_schema = 'public'
          and table_name = any($1::text[])
        order by table_name, ordinal_position
      `,
        [VIEWS],
      ),
    ]);

    console.log(
      `Extensions: ${extensions.rows.map((row) => row.extname).join(', ') || '(none)'}`,
    );
    console.log('');

    for (const table of TABLES) {
      const rows = indexes.rows.filter((row) => row.tablename === table);
      console.log(`public.${table}`);
      if (!rows.length) {
        console.log('  (no indexes found)');
      } else {
        for (const row of rows) {
          console.log(`  - ${row.indexname}`);
          console.log(`    ${row.indexdef}`);
        }
      }
      console.log('');
    }

    for (const view of VIEWS) {
      const columns = viewColumns.rows
        .filter((row) => row.table_name === view)
        .map((row) => row.column_name);
      console.log(`public.${view} columns:`);
      console.log(`  ${columns.join(', ') || '(view missing)'}`);
      console.log('');
    }
  } finally {
    await client.end().catch(() => {});
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error && error.stack ? error.stack : error);
    process.exit(1);
  });
}
