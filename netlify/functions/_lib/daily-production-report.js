'use strict';

const { ensureOrderPipelineView } = require('./order-pipeline');

const TIMEZONE = 'Europe/Prague';
const XML_EXPECTED_DELAY_MINUTES = 90;

function cleanDate(value) {
  const raw = String(value || '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : null;
}

function pragueToday() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${map.year}-${map.month}-${map.day}`;
}

function selectedDate(value) {
  return cleanDate(value) || pragueToday();
}

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function int(value) {
  return Math.trunc(num(value));
}

function fmtNumber(value, digits = 0) {
  return num(value).toLocaleString('cs-CZ', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function printDateExpr(column) {
  return `coalesce(${column}::date, source_date)`;
}

async function safeQuery(client, sql, params, fallbackRows = []) {
  try {
    const result = await client.query(sql, params);
    return result.rows || [];
  } catch (error) {
    console.warn('daily report query failed', {
      message: error && error.message,
      code: error && error.code,
    });
    return fallbackRows;
  }
}

async function loadPrintSummary(client, date) {
  const totalsRows = await safeQuery(client, `
    select
      count(*) filter (where lower(coalesce(result, '')) = 'done')::int as done_jobs,
      count(*) filter (where lower(coalesce(result, '')) in ('abrt', 'aborted'))::int as aborted_jobs,
      count(*) filter (where lower(coalesce(result, '')) = 'deleted')::int as deleted_jobs,
      coalesce(sum(printed_area_m2) filter (where lower(coalesce(result, '')) = 'done'), 0)::float8 as printed_area_m2,
      coalesce(sum(media_length_m) filter (where lower(coalesce(result, '')) = 'done'), 0)::float8 as media_length_m,
      count(*)::int as total_rows
    from public.v_print_log_rows
    where ${printDateExpr('ready_at')} = $1::date
      and (row_type is null or lower(row_type) = 'print')
  `, [date], [{
    done_jobs: 0,
    aborted_jobs: 0,
    deleted_jobs: 0,
    printed_area_m2: 0,
    media_length_m: 0,
    total_rows: 0,
  }]);

  const printerRows = await safeQuery(client, `
    select
      printer_name,
      count(*) filter (where lower(coalesce(result, '')) = 'done')::int as done_jobs,
      count(*) filter (where lower(coalesce(result, '')) in ('abrt', 'aborted'))::int as aborted_jobs,
      count(*) filter (where lower(coalesce(result, '')) = 'deleted')::int as deleted_jobs,
      coalesce(sum(printed_area_m2) filter (where lower(coalesce(result, '')) = 'done'), 0)::float8 as printed_area_m2,
      coalesce(sum(media_length_m) filter (where lower(coalesce(result, '')) = 'done'), 0)::float8 as media_length_m
    from public.v_print_log_rows
    where ${printDateExpr('ready_at')} = $1::date
      and (row_type is null or lower(row_type) = 'print')
    group by printer_name
    order by printer_name
  `, [date]);

  const latestRows = await safeQuery(client, `
    select max(ready_at) as latest_ready_at
    from public.v_print_log_rows
    where (row_type is null or lower(row_type) = 'print')
  `, []);

  const totals = totalsRows[0] || {};
  return {
    doneJobs: int(totals.done_jobs),
    abortedJobs: int(totals.aborted_jobs),
    deletedJobs: int(totals.deleted_jobs),
    printedAreaM2: num(totals.printed_area_m2),
    mediaLengthM: num(totals.media_length_m),
    totalRows: int(totals.total_rows),
    latestReadyAt: latestRows[0] && latestRows[0].latest_ready_at ? latestRows[0].latest_ready_at : null,
    printers: printerRows.map((row) => ({
      printerName: row.printer_name || 'Unknown printer',
      doneJobs: int(row.done_jobs),
      abortedJobs: int(row.aborted_jobs),
      deletedJobs: int(row.deleted_jobs),
      printedAreaM2: num(row.printed_area_m2),
      mediaLengthM: num(row.media_length_m),
    })),
  };
}

async function loadPipelineSummary(client, date) {
  await ensureOrderPipelineView(client);

  const [receivedRows, processedRows, waitingRows, orphanRows, reprintRows, delayedRows] = await Promise.all([
    client.query(`
      select count(*)::int as count
      from public.print_orders_received
      where (coalesce(received_at, api_seen_at) at time zone $2)::date = $1::date
    `, [date, TIMEZONE]),
    client.query(`
      select count(*)::int as count
      from public.processed_print_orders
      where (queued_date_time at time zone $2)::date = $1::date
        and upper(coalesce(order_type, 'S')) <> 'R'
    `, [date, TIMEZONE]),
    client.query(`
      select count(*)::int as count
      from public.print_orders_received i
      where not exists (
        select 1
        from public.processed_print_orders p
        where upper(coalesce(p.order_type, 'S')) <> 'R'
          and p.order_name = any(array_remove(array[
            i.order_number,
            i.external_order_id,
            i.customer_order_id
          ], null))
      )
    `),
    client.query(`
      select count(*)::int as count
      from public.processed_print_orders p
      where upper(coalesce(p.order_type, 'S')) <> 'R'
        and not exists (
          select 1
          from public.print_orders_received i
          where p.order_name = any(array_remove(array[
            i.order_number,
            i.external_order_id,
            i.customer_order_id
          ], null))
        )
    `),
    client.query(`
      select
        count(*) filter (where status = 'pending')::int as pending_count,
        count(*) filter (
          where status in ('completed', 'resolved', 'done')
            and confirmed_at is not null
            and (confirmed_at at time zone $2)::date = $1::date
        )::int as completed_today
      from public.processed_order_reprint_requests
    `, [date, TIMEZONE]),
    client.query(`
      select
        count(*)::int as count,
        (array_agg(coalesce(i.order_number, i.external_order_id, i.customer_order_id) order by coalesce(i.received_at, i.api_seen_at) asc))[1:5] as samples
      from public.print_orders_received i
      where coalesce(i.received_at, i.api_seen_at) < now() - ($1::text || ' minutes')::interval
        and not exists (
          select 1
          from public.processed_print_orders p
          where upper(coalesce(p.order_type, 'S')) <> 'R'
            and p.order_name = any(array_remove(array[
              i.order_number,
              i.external_order_id,
              i.customer_order_id
            ], null))
        )
    `, [XML_EXPECTED_DELAY_MINUTES]),
  ]);

  const reprint = reprintRows.rows[0] || {};
  const delayed = delayedRows.rows[0] || {};
  return {
    receivedToday: int(receivedRows.rows[0] && receivedRows.rows[0].count),
    processedToday: int(processedRows.rows[0] && processedRows.rows[0].count),
    waiting: int(waitingRows.rows[0] && waitingRows.rows[0].count),
    processedWithoutApi: int(orphanRows.rows[0] && orphanRows.rows[0].count),
    reprintPending: int(reprint.pending_count),
    reprintCompletedToday: int(reprint.completed_today),
    delayedWaiting: int(delayed.count),
    delayedSamples: Array.isArray(delayed.samples) ? delayed.samples.filter(Boolean) : [],
  };
}

function buildWarnings(print, pipeline) {
  const warnings = [];
  const failedJobs = print.abortedJobs + print.deletedJobs;

  if (!print.totalRows) {
    warnings.push('No Colorado print data found for this date.');
  }
  if (failedJobs > 0) {
    warnings.push(`${failedJobs} Colorado jobs were aborted/deleted.`);
  }
  if (pipeline.delayedWaiting > 0) {
    warnings.push(`${pipeline.delayedWaiting} API orders have no processed XML after ${XML_EXPECTED_DELAY_MINUTES} minutes.`);
  } else if (pipeline.waiting > 0) {
    warnings.push(`${pipeline.waiting} API orders are received but not processed yet.`);
  }
  if (pipeline.processedWithoutApi > 0) {
    warnings.push(`${pipeline.processedWithoutApi} processed XML orders have no matching API order.`);
  }
  if (pipeline.reprintPending > 0) {
    warnings.push(`${pipeline.reprintPending} reprint requests are pending.`);
  }

  return warnings;
}

function buildEmail(report) {
  const failedJobs = report.print.abortedJobs + report.print.deletedJobs;
  const subject = `PrintGuard Daily Report · ${report.date}`;
  const printerLines = report.print.printers.length
    ? report.print.printers.map((printer) => `- ${printer.printerName}: ${printer.doneJobs} done · ${fmtNumber(printer.printedAreaM2, 2)} m2 · ${fmtNumber(printer.mediaLengthM, 2)} m · ${printer.abortedJobs + printer.deletedJobs} aborted/deleted`)
    : ['- No Colorado rows for this date.'];
  const warningLines = report.warnings.length
    ? report.warnings.map((warning) => `- ${warning}`)
    : ['- No notable warnings.'];

  const text = [
    subject,
    '',
    'TL;DR',
    `- Printed jobs: ${report.print.doneJobs}`,
    `- Aborted/deleted: ${failedJobs}`,
    `- Received orders: ${report.pipeline.receivedToday}`,
    `- Processed by Submit Tool: ${report.pipeline.processedToday}`,
    `- Waiting: ${report.pipeline.waiting}`,
    `- Pending reprints: ${report.pipeline.reprintPending}`,
    '',
    'Printed today',
    ...printerLines,
    `- Total area: ${fmtNumber(report.print.printedAreaM2, 2)} m2`,
    `- Media length: ${fmtNumber(report.print.mediaLengthM, 2)} m`,
    '',
    'Orders / pipeline',
    `- Received from API: ${report.pipeline.receivedToday}`,
    `- Processed XML: ${report.pipeline.processedToday}`,
    `- Waiting / received but not processed: ${report.pipeline.waiting}`,
    `- Processed without matching API: ${report.pipeline.processedWithoutApi}`,
    '',
    'Waiting / warnings',
    ...warningLines,
    '',
    'Reprints',
    `- Pending: ${report.pipeline.reprintPending}`,
    `- Completed today: ${report.pipeline.reprintCompletedToday}`,
    '',
    'Notes',
    'Generated by PrintGuard.',
  ].join('\n');

  const section = (title, lines) => `<h3>${escapeHtml(title)}</h3><ul>${lines.map((line) => `<li>${escapeHtml(line.replace(/^- /, ''))}</li>`).join('')}</ul>`;
  const html = [
    `<h2>${escapeHtml(subject)}</h2>`,
    section('TL;DR', [
      `Printed jobs: ${report.print.doneJobs}`,
      `Aborted/deleted: ${failedJobs}`,
      `Received orders: ${report.pipeline.receivedToday}`,
      `Processed by Submit Tool: ${report.pipeline.processedToday}`,
      `Waiting: ${report.pipeline.waiting}`,
      `Pending reprints: ${report.pipeline.reprintPending}`,
    ]),
    section('Printed today', printerLines),
    section('Orders / pipeline', [
      `Received from API: ${report.pipeline.receivedToday}`,
      `Processed XML: ${report.pipeline.processedToday}`,
      `Waiting / received but not processed: ${report.pipeline.waiting}`,
      `Processed without matching API: ${report.pipeline.processedWithoutApi}`,
    ]),
    section('Waiting / warnings', warningLines),
    section('Reprints', [
      `Pending: ${report.pipeline.reprintPending}`,
      `Completed today: ${report.pipeline.reprintCompletedToday}`,
    ]),
    '<p>Generated by PrintGuard.</p>',
  ].join('\n');

  return { subject, text, html };
}

async function buildDailyProductionReport(client, options = {}) {
  const date = selectedDate(options.date);
  const [print, pipeline] = await Promise.all([
    loadPrintSummary(client, date),
    loadPipelineSummary(client, date),
  ]);
  const warnings = buildWarnings(print, pipeline);
  const base = {
    ok: true,
    date,
    timezone: TIMEZONE,
    print: {
      doneJobs: print.doneJobs,
      abortedJobs: print.abortedJobs,
      deletedJobs: print.deletedJobs,
      printedAreaM2: print.printedAreaM2,
      mediaLengthM: print.mediaLengthM,
      printers: print.printers,
    },
    pipeline: {
      receivedToday: pipeline.receivedToday,
      processedToday: pipeline.processedToday,
      waiting: pipeline.waiting,
      processedWithoutApi: pipeline.processedWithoutApi,
      reprintPending: pipeline.reprintPending,
      reprintCompletedToday: pipeline.reprintCompletedToday,
    },
    warnings,
    generatedAt: new Date().toISOString(),
  };
  return {
    ...base,
    email: buildEmail(base),
  };
}

module.exports = {
  TIMEZONE,
  buildDailyProductionReport,
  selectedDate,
};
