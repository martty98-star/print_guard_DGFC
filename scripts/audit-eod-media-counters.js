'use strict';

const { Client } = require('pg');
const {
  DEFAULT_MEDIA_WIDTH_M,
  summarizeCounterBreakdown,
} = require('../netlify/functions/_lib/eod-media-counters');

function arg(name, fallback) {
  const prefix = `--${name}=`;
  const found = process.argv.find((value) => value.startsWith(prefix));
  return found ? found.slice(prefix.length) : fallback;
}

function fmt(value, digits = 3) {
  if (value == null || value === '') return '—';
  const n = Number(value);
  return Number.isFinite(n) ? n.toFixed(digits) : String(value);
}

async function main() {
  const date = arg('date', '2026-06-08');
  const widthM =
    Number(arg('width-m', DEFAULT_MEDIA_WIDTH_M)) || DEFAULT_MEDIA_WIDTH_M;
  const conn =
    process.env.NEON_DATABASE_URL ||
    process.env.DATABASE_URL ||
    process.env.NETLIFY_DATABASE_URL;
  if (!conn)
    throw new Error(
      'Missing NEON_DATABASE_URL, DATABASE_URL, or NETLIFY_DATABASE_URL',
    );

  const client = new Client({
    connectionString: conn,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  try {
    const nextDayResult = await client.query(
      `select ($1::date + interval '1 day')::date::text as next_day`,
      [date],
    );
    const nextDay = nextDayResult.rows[0].next_day;

    const rangeResult = await client.query(`
      select machine_id, count(*)::int as count, min(timestamp) as min_ts, max(timestamp) as max_ts
      from public.pg_co_records
      group by machine_id
      order by machine_id
    `);
    const counterResult = await client.query(
      `
      select
        machine_id,
        (array_agg(jsonb_build_object('id', id, 'machine_id', machine_id, 'timestamp', timestamp, 'data', data) order by timestamp asc, updated_at asc))[1] as start_record,
        (array_agg(jsonb_build_object('id', id, 'machine_id', machine_id, 'timestamp', timestamp, 'data', data) order by timestamp desc, updated_at desc))[1] as end_record,
        count(*)::int as record_count
      from public.pg_co_records
      where timestamp >= $1::date
        and timestamp < $2::date
      group by machine_id
    `,
      [date, nextDay],
    );
    const printLogResult = await client.query(
      `
      select
        printer_name,
        count(*)::int as done_jobs,
        coalesce(sum(printed_area::numeric / 1000000.0), 0)::float8 as consumed_media_m2,
        coalesce(sum(media_length_used::numeric / 10000.0), 0)::float8 as consumed_media_length_m,
        coalesce(sum((coalesce(ink_cyan, 0) + coalesce(ink_magenta, 0) + coalesce(ink_yellow, 0) + coalesce(ink_black, 0) + coalesce(ink_white, 0))::numeric / 1000000.0), 0)::float8 as consumed_ink_l
      from public.print_accounting_rows
      where lower(coalesce(result, '')) = 'done'
        and (row_type is null or lower(row_type) = 'print')
        and coalesce(ready_at::date, source_date) >= $1::date
        and coalesce(ready_at::date, source_date) < $2::date
      group by printer_name
      order by printer_name
    `,
      [date, nextDay],
    );

    const rowsByMachine = {};
    for (const row of counterResult.rows) {
      rowsByMachine[row.machine_id] = {
        start: row.start_record,
        end: row.end_record,
      };
    }
    const breakdown = summarizeCounterBreakdown(rowsByMachine, {
      mediaWidthM: widthM,
    });
    const printLogTotal = printLogResult.rows.reduce(
      (sum, row) => sum + Number(row.consumed_media_m2 || 0),
      0,
    );

    console.log(`EOD media counter audit for ${date}`);
    console.log(`Counter window: ${date} <= timestamp < ${nextDay}`);
    console.log(
      `Roll reality: 130 m * ${widthM} m = ${(130 * widthM).toFixed(3)} m2 per roll`,
    );
    console.log('');
    console.log('pg_co_records available ranges:');
    for (const row of rangeResult.rows) {
      console.log(
        `  ${row.machine_id}: count=${row.count}, min=${row.min_ts ? row.min_ts.toISOString() : '—'}, max=${row.max_ts ? row.max_ts.toISOString() : '—'}`,
      );
    }
    console.log('');

    for (const row of breakdown.printers) {
      console.log(`${row.printer}:`);
      console.log(`  start timestamp: ${row.start?.timestamp || '—'}`);
      console.log(`  start ink total L: ${fmt(row.start?.inkTotalL, 4)}`);
      console.log(`  start media length m: ${fmt(row.start?.mediaLengthM, 3)}`);
      console.log(`  start media area m2: ${fmt(row.start?.mediaAreaM2, 3)}`);
      console.log(`  end timestamp: ${row.end?.timestamp || '—'}`);
      console.log(`  end ink total L: ${fmt(row.end?.inkTotalL, 4)}`);
      console.log(`  end media length m: ${fmt(row.end?.mediaLengthM, 3)}`);
      console.log(`  end media area m2: ${fmt(row.end?.mediaAreaM2, 3)}`);
      console.log(`  delta media length m: ${fmt(row.deltaMediaLengthM, 3)}`);
      console.log(`  delta media area m2: ${fmt(row.deltaMediaAreaM2, 3)}`);
      console.log(
        `  equivalent 130m rolls: ${fmt(row.equivalentRolls130m, 3)}`,
      );
      for (const warning of row.warnings || [])
        console.log(`  warning: ${warning}`);
      console.log('');
    }

    console.log('Print-log EOD diagnostic by printer:');
    for (const row of printLogResult.rows) {
      console.log(
        `  ${row.printer_name || 'Unknown'}: jobs=${row.done_jobs}, area=${fmt(row.consumed_media_m2, 3)} m2, length=${fmt(row.consumed_media_length_m, 3)} m, ink=${fmt(row.consumed_ink_l, 4)} L`,
      );
    }
    console.log('');
    console.log('Total:');
    console.log(
      `  counter delta media area m2: ${fmt(breakdown.total.deltaMediaAreaM2, 3)}`,
    );
    console.log(
      `  counter equivalent 130m rolls: ${fmt(breakdown.total.equivalentRolls130m, 3)}`,
    );
    console.log(
      `  EOD displayed before fix / print-log diagnostic: ${fmt(printLogTotal, 3)} m2`,
    );
    console.log(
      `  difference: ${breakdown.total.deltaMediaAreaM2 == null ? '—' : fmt(printLogTotal - breakdown.total.deltaMediaAreaM2, 3)} m2`,
    );
    if (breakdown.warnings.length) {
      console.log('');
      console.log('Warnings:');
      for (const warning of breakdown.warnings) console.log(`  - ${warning}`);
    }
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
