'use strict';

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

function localTimestampDayFilter(column) {
  return `${column} >= $1::date::timestamp and ${column} < ($1::date + interval '1 day')::timestamp`;
}

function zonedTimestamptzDayFilter(column) {
  return `${column} >= ($1::date::timestamp at time zone $2) and ${column} < (($1::date + interval '1 day')::timestamp at time zone $2)`;
}

function printLogDayFilter() {
  return `((${localTimestampDayFilter('ready_at')}) or (ready_at is null and source_date = $1::date))`;
}

function processedDayExpr() {
  return 'coalesce(queued_date_time, imported_at, updated_at)';
}

function orderMatchCondition(orderAlias, processedAlias) {
  return `${processedAlias}.order_name = any(array_remove(array[
    ${orderAlias}.order_number,
    ${orderAlias}.external_order_id,
    ${orderAlias}.customer_order_id
  ], null))`;
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

async function loadMachineOutput(client, date) {
  const totalsRows = await safeQuery(client, `
    select
      count(*) filter (where lower(coalesce(result, '')) = 'done')::int as done_jobs,
      count(*) filter (where lower(coalesce(result, '')) in ('abrt', 'aborted'))::int as aborted_jobs,
      count(*) filter (where lower(coalesce(result, '')) = 'deleted')::int as deleted_jobs,
      coalesce(sum(printed_area_m2) filter (where lower(coalesce(result, '')) = 'done'), 0)::float8 as printed_area_m2,
      coalesce(sum(media_length_m) filter (where lower(coalesce(result, '')) = 'done'), 0)::float8 as media_length_m,
      count(*)::int as total_rows
    from public.v_print_log_rows
    where ${printLogDayFilter()}
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
    where ${printLogDayFilter()}
      and (row_type is null or lower(row_type) = 'print')
    group by printer_name
    order by printer_name
  `, [date]);

  const totals = totalsRows[0] || {};
  return {
    doneJobs: int(totals.done_jobs),
    abortedJobs: int(totals.aborted_jobs),
    deletedJobs: int(totals.deleted_jobs),
    printedAreaM2: num(totals.printed_area_m2),
    mediaLengthM: num(totals.media_length_m),
    totalRows: int(totals.total_rows),
    note: 'Machine jobs are nest/job level and may contain multiple orders. They are not used as order count.',
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
  const processedDateColumn = processedDayExpr();
  const match = orderMatchCondition('i', 'p');

  const [
    processedRows,
    apiRows,
    todayWaitingRows,
    olderWaitingRows,
    processedUnmatchedRows,
    unmatchedBacklogRows,
    reprintRows,
    delayedTodayRows,
  ] = await Promise.all([
    client.query(`
      select
        count(*)::int as total,
        count(*) filter (where upper(coalesce(order_type, 'S')) = 'S')::int as single_count,
        count(*) filter (where upper(coalesce(order_type, 'S')) = 'C')::int as combi_count,
        count(*) filter (where upper(coalesce(order_type, 'S')) = 'R')::int as reprint_xml_count
      from public.processed_print_orders
      where ${zonedTimestamptzDayFilter(processedDateColumn)}
    `, [date, TIMEZONE]),
    client.query(`
      select
        count(*)::int as received_today,
        count(*) filter (
          where exists (
            select 1
            from public.processed_print_orders p
            where upper(coalesce(p.order_type, 'S')) <> 'R'
              and ${match}
          )
        )::int as processed_from_today
      from public.print_orders_received i
      where ${zonedTimestamptzDayFilter('coalesce(i.received_at, i.api_seen_at)')}
    `, [date, TIMEZONE]),
    client.query(`
      select count(*)::int as count
      from public.print_orders_received i
      where ${zonedTimestamptzDayFilter('coalesce(i.received_at, i.api_seen_at)')}
        and not exists (
          select 1
          from public.processed_print_orders p
          where upper(coalesce(p.order_type, 'S')) <> 'R'
            and ${match}
        )
    `, [date, TIMEZONE]),
    client.query(`
      select count(*)::int as count
      from public.print_orders_received i
      where coalesce(i.received_at, i.api_seen_at) < ($1::date::timestamp at time zone $2)
        and not exists (
          select 1
          from public.processed_print_orders p
          where upper(coalesce(p.order_type, 'S')) <> 'R'
            and ${match}
        )
    `, [date, TIMEZONE]),
    client.query(`
      select count(*)::int as count
      from public.processed_print_orders p
      where ${zonedTimestamptzDayFilter(processedDateColumn)}
        and upper(coalesce(p.order_type, 'S')) <> 'R'
        and not exists (
          select 1
          from public.print_orders_received i
          where ${match}
        )
    `, [date, TIMEZONE]),
    client.query(`
      select count(*)::int as count
      from public.processed_print_orders p
      where upper(coalesce(p.order_type, 'S')) <> 'R'
        and not exists (
          select 1
          from public.print_orders_received i
          where ${match}
        )
    `),
    client.query(`
      select
        count(*) filter (where ${zonedTimestamptzDayFilter('requested_at')})::int as requested_today,
        count(*) filter (
          where lower(coalesce(status, '')) in ('completed', 'resolved', 'done')
            and confirmed_at is not null
            and ${zonedTimestamptzDayFilter('confirmed_at')}
        )::int as completed_today,
        count(*) filter (where lower(coalesce(status, '')) = 'pending')::int as pending_backlog
      from public.processed_order_reprint_requests
    `, [date, TIMEZONE]),
    client.query(`
      select count(*)::int as count
      from public.print_orders_received i
      where ${zonedTimestamptzDayFilter('coalesce(i.received_at, i.api_seen_at)')}
        and coalesce(i.received_at, i.api_seen_at) < now() - ($3::text || ' minutes')::interval
        and not exists (
          select 1
          from public.processed_print_orders p
          where upper(coalesce(p.order_type, 'S')) <> 'R'
            and ${match}
        )
    `, [date, TIMEZONE, XML_EXPECTED_DELAY_MINUTES]),
  ]);

  const processed = processedRows.rows[0] || {};
  const api = apiRows.rows[0] || {};
  const reprint = reprintRows.rows[0] || {};
  const single = int(processed.single_count);
  const combi = int(processed.combi_count);
  const reprintXml = int(processed.reprint_xml_count);

  return {
    receivedToday: int(api.received_today),
    apiProcessedToday: int(api.processed_from_today),
    processedToday: int(processed.total),
    processedNormalToday: single + combi,
    processedSingleToday: single,
    processedCombiToday: combi,
    processedReprintXmlToday: reprintXml,
    waitingToday: int(todayWaitingRows.rows[0] && todayWaitingRows.rows[0].count),
    olderWaitingBacklog: int(olderWaitingRows.rows[0] && olderWaitingRows.rows[0].count),
    processedWithoutApiToday: int(processedUnmatchedRows.rows[0] && processedUnmatchedRows.rows[0].count),
    processedWithoutApiBacklog: int(unmatchedBacklogRows.rows[0] && unmatchedBacklogRows.rows[0].count),
    reprintsRequestedToday: int(reprint.requested_today),
    reprintCompletedToday: int(reprint.completed_today),
    reprintPendingBacklog: int(reprint.pending_backlog),
    delayedWaitingToday: int(delayedTodayRows.rows[0] && delayedTodayRows.rows[0].count),
  };
}

function buildWarnings(machineOutput, pipeline) {
  const warnings = [];
  const failedMachineJobs = machineOutput.abortedJobs + machineOutput.deletedJobs;

  if (!machineOutput.totalRows) {
    warnings.push('No Colorado machine output rows found for this date.');
  }
  if (failedMachineJobs > 0) {
    warnings.push(`${failedMachineJobs} Colorado machine jobs were aborted/deleted.`);
  }
  if (pipeline.delayedWaitingToday > 0) {
    warnings.push(`API orders from today older than ${XML_EXPECTED_DELAY_MINUTES} minutes without processed XML: ${pipeline.delayedWaitingToday}.`);
  }
  if (pipeline.processedWithoutApiToday > 0) {
    warnings.push(`Processed XML today without matching API: ${pipeline.processedWithoutApiToday}.`);
  }
  if (pipeline.olderWaitingBacklog > 0) {
    warnings.push(`Older waiting backlog: ${pipeline.olderWaitingBacklog}.`);
  }
  if (pipeline.processedWithoutApiBacklog > 0) {
    warnings.push(`All-time unmatched processed XML backlog: ${pipeline.processedWithoutApiBacklog}.`);
  }
  if (pipeline.reprintPendingBacklog > 0) {
    warnings.push(`Pending reprint backlog: ${pipeline.reprintPendingBacklog}.`);
  }

  return warnings;
}

function buildEmail(report) {
  const subject = `PrintGuard Daily Report · ${report.date}`;
  const machine = report.machineOutput;
  const pipeline = report.pipeline;
  const machineLines = machine.printers.length
    ? machine.printers.map((printer) => `- ${printer.printerName}: ${printer.doneJobs} done · ${printer.abortedJobs} aborted · ${printer.deletedJobs} deleted · ${fmtNumber(printer.printedAreaM2, 2)} m2 · ${fmtNumber(printer.mediaLengthM, 2)} m`)
    : ['- No Colorado machine output rows for this date.'];
  const warningLines = [
    `- API orders from today older than ${XML_EXPECTED_DELAY_MINUTES} minutes without processed XML: ${pipeline.delayedWaitingToday}`,
    `- Processed XML today without matching API: ${pipeline.processedWithoutApiToday}`,
    `- Pending reprint backlog: ${pipeline.reprintPendingBacklog}`,
  ];
  const extraWarningLines = report.warnings
    .filter((warning) => !warning.startsWith('API orders from today older than')
      && !warning.startsWith('Processed XML today without matching API')
      && !warning.startsWith('Pending reprint backlog'))
    .map((warning) => `- ${warning}`);

  const text = [
    subject,
    '',
    'TL;DR',
    `- Processed by Submit Tool today: ${pipeline.processedToday}`,
    `- API orders received today: ${pipeline.receivedToday}`,
    `- Waiting from today: ${pipeline.waitingToday}`,
    `- Reprint XML processed today: ${pipeline.processedReprintXmlToday}`,
    `- Machine output: ${fmtNumber(machine.printedAreaM2, 2)} m2 / ${fmtNumber(machine.mediaLengthM, 2)} m`,
    '',
    'Production pipeline',
    `- Received from API today: ${pipeline.receivedToday}`,
    `- API orders from today already processed: ${pipeline.apiProcessedToday}`,
    `- Processed XML today: ${pipeline.processedToday}`,
    `- Normal processed: ${pipeline.processedNormalToday} (S: ${pipeline.processedSingleToday}, C: ${pipeline.processedCombiToday})`,
    `- Reprint XML processed: ${pipeline.processedReprintXmlToday}`,
    `- Waiting from today: ${pipeline.waitingToday}`,
    `- Older waiting backlog: ${pipeline.olderWaitingBacklog}`,
    '',
    'Machine output today',
    ...machineLines,
    `- Total machine output: ${fmtNumber(machine.printedAreaM2, 2)} m2 / ${fmtNumber(machine.mediaLengthM, 2)} m`,
    `- Note: ${machine.note}`,
    '',
    'Warnings',
    ...warningLines,
    ...extraWarningLines,
    '',
    'Reprints',
    `- Requested today: ${pipeline.reprintsRequestedToday}`,
    `- Completed today: ${pipeline.reprintCompletedToday}`,
    `- Pending backlog: ${pipeline.reprintPendingBacklog}`,
    '',
    'Notes',
    'Generated by PrintGuard.',
  ].join('\n');

  const section = (title, lines) => `<h3>${escapeHtml(title)}</h3><ul>${lines.map((line) => `<li>${escapeHtml(line.replace(/^- /, ''))}</li>`).join('')}</ul>`;
  const html = [
    `<h2>${escapeHtml(subject)}</h2>`,
    section('TL;DR', [
      `Processed by Submit Tool today: ${pipeline.processedToday}`,
      `API orders received today: ${pipeline.receivedToday}`,
      `Waiting from today: ${pipeline.waitingToday}`,
      `Reprint XML processed today: ${pipeline.processedReprintXmlToday}`,
      `Machine output: ${fmtNumber(machine.printedAreaM2, 2)} m2 / ${fmtNumber(machine.mediaLengthM, 2)} m`,
    ]),
    section('Production pipeline', [
      `Received from API today: ${pipeline.receivedToday}`,
      `API orders from today already processed: ${pipeline.apiProcessedToday}`,
      `Processed XML today: ${pipeline.processedToday}`,
      `Normal processed: ${pipeline.processedNormalToday} (S: ${pipeline.processedSingleToday}, C: ${pipeline.processedCombiToday})`,
      `Reprint XML processed: ${pipeline.processedReprintXmlToday}`,
      `Waiting from today: ${pipeline.waitingToday}`,
      `Older waiting backlog: ${pipeline.olderWaitingBacklog}`,
    ]),
    section('Machine output today', machineLines.concat([
      `Total machine output: ${fmtNumber(machine.printedAreaM2, 2)} m2 / ${fmtNumber(machine.mediaLengthM, 2)} m`,
      `Note: ${machine.note}`,
    ])),
    section('Warnings', warningLines.concat(extraWarningLines)),
    section('Reprints', [
      `Requested today: ${pipeline.reprintsRequestedToday}`,
      `Completed today: ${pipeline.reprintCompletedToday}`,
      `Pending backlog: ${pipeline.reprintPendingBacklog}`,
    ]),
    '<p>Generated by PrintGuard.</p>',
  ].join('\n');

  return { subject, text, html };
}

async function buildDailyProductionReport(client, options = {}) {
  const date = selectedDate(options.date);
  const [machineOutput, pipeline] = await Promise.all([
    loadMachineOutput(client, date),
    loadPipelineSummary(client, date),
  ]);
  const warnings = buildWarnings(machineOutput, pipeline);
  const base = {
    ok: true,
    date,
    timezone: TIMEZONE,
    print: {
      doneJobs: machineOutput.doneJobs,
      abortedJobs: machineOutput.abortedJobs,
      deletedJobs: machineOutput.deletedJobs,
      printedAreaM2: machineOutput.printedAreaM2,
      mediaLengthM: machineOutput.mediaLengthM,
      printers: machineOutput.printers,
      note: machineOutput.note,
    },
    machineOutput: {
      doneJobs: machineOutput.doneJobs,
      abortedJobs: machineOutput.abortedJobs,
      deletedJobs: machineOutput.deletedJobs,
      printedAreaM2: machineOutput.printedAreaM2,
      mediaLengthM: machineOutput.mediaLengthM,
      printers: machineOutput.printers,
      note: machineOutput.note,
    },
    pipeline: {
      receivedToday: pipeline.receivedToday,
      apiProcessedToday: pipeline.apiProcessedToday,
      processedToday: pipeline.processedToday,
      processedNormalToday: pipeline.processedNormalToday,
      processedSingleToday: pipeline.processedSingleToday,
      processedCombiToday: pipeline.processedCombiToday,
      processedReprintXmlToday: pipeline.processedReprintXmlToday,
      waiting: pipeline.waitingToday,
      waitingToday: pipeline.waitingToday,
      olderWaitingBacklog: pipeline.olderWaitingBacklog,
      processedWithoutApi: pipeline.processedWithoutApiToday,
      processedWithoutApiToday: pipeline.processedWithoutApiToday,
      processedWithoutApiBacklog: pipeline.processedWithoutApiBacklog,
      reprintsRequestedToday: pipeline.reprintsRequestedToday,
      reprintCompletedToday: pipeline.reprintCompletedToday,
      reprintPending: pipeline.reprintPendingBacklog,
      reprintPendingBacklog: pipeline.reprintPendingBacklog,
      delayedWaitingToday: pipeline.delayedWaitingToday,
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
