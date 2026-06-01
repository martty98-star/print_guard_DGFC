'use strict';

const TIMEZONE = 'Europe/Prague';
const INK_BOTTLE_L_FALLBACK = 0.7;

let schemaReady = false;

function cleanString(value) {
  if (value == null) return '';
  return String(value).trim();
}

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function int(value) {
  return Math.trunc(num(value));
}

function round(value, digits = 3) {
  const factor = 10 ** digits;
  return Math.round(num(value) * factor) / factor;
}

function isIsoDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(cleanString(value));
}

function isIsoMonth(value) {
  return /^\d{4}-\d{2}$/.test(cleanString(value));
}

function dateFromIso(value) {
  const [year, month, day] = cleanString(value).split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function formatDate(date) {
  return date.toISOString().slice(0, 10);
}

function addDays(dateString, days) {
  const date = dateFromIso(dateString);
  date.setUTCDate(date.getUTCDate() + days);
  return formatDate(date);
}

function addMonths(month, delta) {
  const [year, monthNumber] = month.split('-').map(Number);
  const date = new Date(Date.UTC(year, monthNumber - 1 + delta, 1));
  return date.toISOString().slice(0, 7);
}

function monthStart(month) {
  return `${month}-01`;
}

function nextMonthStart(month) {
  return `${addMonths(month, 1)}-01`;
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

function defaultCompletedMonth() {
  return addMonths(pragueToday().slice(0, 7), -1);
}

function resolveMonth(value) {
  return isIsoMonth(value) ? cleanString(value) : defaultCompletedMonth();
}

function resolveReportDate(value) {
  return isIsoDate(value) ? cleanString(value) : pragueToday();
}

function incomingPeriodForReportDate(reportDate) {
  const day = dateFromIso(reportDate).getUTCDay();
  if (day === 1) {
    return {
      start: addDays(reportDate, -3),
      end: reportDate,
      label: 'Friday-Sunday closed API intake',
    };
  }
  return {
    start: addDays(reportDate, -1),
    end: reportDate,
    label: 'Previous-day closed API intake',
  };
}

function normalizeStockType(value) {
  const normalized = cleanString(value).toLowerCase();
  if (normalized.includes('ink') || normalized.includes('inkoust')) return 'ink';
  if (normalized.includes('media') || normalized.includes('paper') || normalized.includes('papír') || normalized.includes('papir')) return 'media';
  return normalized;
}

function litersPerUnit(item) {
  const candidates = [
    item.litersPerUnit,
    item.literPerUnit,
    item.liters,
    item.l,
    item.volumeL,
    item.volume_l,
  ];
  for (const value of candidates) {
    const parsed = num(value);
    if (parsed > 0) return parsed;
  }

  const text = `${item.name || ''} ${item.notes || ''}`;
  const ml = text.match(/(\d+(?:[.,]\d+)?)\s*ml\b/i);
  if (ml) return Number(ml[1].replace(',', '.')) / 1000;
  const liters = text.match(/(\d+(?:[.,]\d+)?)\s*l\b/i);
  if (liters) return Number(liters[1].replace(',', '.'));
  return INK_BOTTLE_L_FALLBACK;
}

function mediaM2PerUnit(item) {
  const direct = [
    item.m2PerUnit,
    item.areaM2PerUnit,
    item.rollAreaM2,
    item.areaM2,
    item.mediaM2,
  ];
  for (const value of direct) {
    const parsed = num(value);
    if (parsed > 0) return parsed;
  }
  const width = num(item.widthM || item.width_m || item.mediaWidthM);
  const length = num(item.lengthM || item.length_m || item.rollLengthM);
  return width > 0 && length > 0 ? width * length : 0;
}

function replayStockAt(items, movements, cutoffDateExclusive) {
  const cutoff = new Date(`${cutoffDateExclusive}T00:00:00.000Z`).getTime();
  const movesByArticle = new Map();
  for (const move of movements || []) {
    const timestamp = new Date(move.timestamp || move.createdAt || 0).getTime();
    if (!Number.isFinite(timestamp) || timestamp >= cutoff) continue;
    const article = cleanString(move.articleNumber || move.article_number);
    if (!article) continue;
    if (!movesByArticle.has(article)) movesByArticle.set(article, []);
    movesByArticle.get(article).push(move);
  }

  return (items || [])
    .filter((item) => item && item.isActive !== false)
    .map((item) => {
      const articleNumber = cleanString(item.articleNumber || item.article_number);
      const sorted = (movesByArticle.get(articleNumber) || []).sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
      let onHand = 0;
      for (const move of sorted) {
        const qty = num(move.qty || move.quantity);
        const type = cleanString(move.movType || move.movement_type).toLowerCase();
        if (type === 'stocktake') onHand = qty;
        else if (type === 'receipt') onHand += qty;
        else if (type === 'issue') onHand = Math.max(0, onHand - qty);
      }
      const stockType = normalizeStockType(item.category || item.stockType || item.type);
      const inkLiters = stockType === 'ink' ? onHand * litersPerUnit(item) : 0;
      const mediaM2 = stockType === 'media' ? onHand * mediaM2PerUnit(item) : 0;
      return {
        articleNumber,
        itemName: item.name || articleNumber,
        category: item.category || '',
        stockType,
        unit: item.unit || 'ks',
        onHand: round(onHand, 3),
        printer: item.printer || item.machine || '',
        mediaType: item.mediaType || item.media_type || '',
        inkStockL: round(inkLiters, 3),
        mediaStockM2: round(mediaM2, 3),
        conversionNote: stockType === 'ink' ? `${round(litersPerUnit(item), 3)} L/unit` : (stockType === 'media' && mediaM2PerUnit(item) > 0 ? `${round(mediaM2PerUnit(item), 3)} m2/unit` : ''),
      };
    });
}

async function ensureReportingSchema(client) {
  if (schemaReady) return;
  await client.query(`
    create table if not exists public.reporting_stock_monthly_snapshots (
      snapshot_month date not null,
      article_number text not null,
      item_name text null,
      category text null,
      stock_type text null,
      unit text null,
      on_hand numeric null,
      media_stock_m2 numeric null,
      ink_stock_l numeric null,
      media_type text null,
      printer text null,
      snapshot_at timestamptz not null default now(),
      source text not null default 'manual_or_scheduled',
      primary key (snapshot_month, article_number)
    )
  `);
  await client.query(`
    create or replace view public.v_reporting_monthly_stock_snapshot as
    select
      to_char(snapshot_month, 'YYYY-MM') as month,
      article_number,
      item_name,
      category,
      stock_type,
      unit,
      on_hand,
      media_stock_m2 as media_stock_m2_end_of_month,
      ink_stock_l as ink_stock_l_end_of_month,
      media_type,
      printer,
      snapshot_at,
      source
    from public.reporting_stock_monthly_snapshots
  `);
  await client.query(`
    create or replace view public.v_reporting_monthly_consumption as
    select
      to_char(date_trunc('month', coalesce(ready_at::date, source_date)::timestamp), 'YYYY-MM') as month,
      printer_name as printer,
      coalesce(nullif(media_type, ''), 'Unknown media') as media_type,
      count(*) filter (where lower(coalesce(result, '')) = 'done')::int as done_jobs,
      coalesce(sum(printed_area::numeric / 1000000.0) filter (where lower(coalesce(result, '')) = 'done'), 0) as total_consumed_media_m2_including_reprints,
      coalesce(sum(media_length_used::numeric / 10000.0) filter (where lower(coalesce(result, '')) = 'done'), 0) as total_consumed_media_length_m,
      coalesce(sum(${inkSql()}) filter (where lower(coalesce(result, '')) = 'done'), 0) as total_consumed_ink_l_including_reprints,
      coalesce(sum(active_time_sec) filter (where lower(coalesce(result, '')) = 'done'), 0)::bigint as nett_printing_time_sec
    from public.print_accounting_rows
    where row_type is null or lower(row_type) = 'print'
    group by 1, 2, 3
  `);
  await client.query(`
    create or replace view public.v_reporting_monthly_reprints as
    select
      to_char(date_trunc('month', coalesce(queued_date_time, imported_at) at time zone 'Europe/Prague'), 'YYYY-MM') as month,
      coalesce(sum(jsonb_array_length(coalesce(print_files, '[]'::jsonb))) filter (where upper(coalesce(order_type, 'S')) <> 'R'), 0)::int as standard_file_count,
      coalesce(sum(jsonb_array_length(coalesce(print_files, '[]'::jsonb))) filter (where upper(coalesce(order_type, 'S')) = 'R'), 0)::int as reprinted_file_count,
      coalesce(sum(jsonb_array_length(coalesce(print_files, '[]'::jsonb))) filter (where upper(coalesce(order_type, 'S')) = 'R'), 0)::numeric
        / nullif(coalesce(sum(jsonb_array_length(coalesce(print_files, '[]'::jsonb))) filter (where upper(coalesce(order_type, 'S')) <> 'R'), 0), 0) as reprinted_files_per_standard_file
    from public.processed_print_orders
    where coalesce(ignored, false) = false
    group by 1
  `);
  await client.query(`
    create or replace view public.v_reporting_monthly_files_per_order as
    with file_counts as (
      select
        to_char(date_trunc('month', coalesce(queued_date_time, imported_at) at time zone 'Europe/Prague'), 'YYYY-MM') as month,
        count(*)::int as total_xml_count,
        coalesce(sum(jsonb_array_length(coalesce(print_files, '[]'::jsonb))), 0)::int as total_files,
        coalesce(sum(jsonb_array_length(coalesce(print_files, '[]'::jsonb))) filter (where upper(coalesce(order_type, 'S')) <> 'R'), 0)::int as standard_files,
        coalesce(sum(jsonb_array_length(coalesce(print_files, '[]'::jsonb))) filter (where upper(coalesce(order_type, 'S')) = 'R'), 0)::int as reprint_files
      from public.processed_print_orders
      where coalesce(ignored, false) = false
      group by 1
    ),
    sales_orders as (
      select
        to_char(date_trunc('month', coalesce(received_at, api_seen_at) at time zone 'Europe/Prague'), 'YYYY-MM') as month,
        count(distinct coalesce(nullif(order_number, ''), nullif(external_order_id, ''), nullif(customer_order_id, '')))::int as total_sales_orders
      from public.print_orders_received
      where coalesce(ignored, false) = false
      group by 1
    )
    select
      coalesce(f.month, s.month) as month,
      coalesce(f.total_xml_count, 0) as total_xml_count,
      coalesce(f.total_files, 0) as total_files,
      coalesce(f.standard_files, 0) as standard_files,
      coalesce(f.reprint_files, 0) as reprint_files,
      coalesce(s.total_sales_orders, 0) as total_sales_orders,
      coalesce(f.total_files, 0)::numeric / nullif(s.total_sales_orders, 0) as avg_files_per_sales_order,
      coalesce(f.total_files, 0)::numeric / nullif(f.total_xml_count, 0) as avg_files_per_xml
    from file_counts f
    full outer join sales_orders s on s.month = f.month
  `);
  await client.query(`
    create or replace view public.v_reporting_eod_printing_time as
    select
      coalesce(ready_at::date, source_date) as report_date,
      printer_name as printer,
      coalesce(nullif(media_type, ''), 'Unknown media') as media_type,
      count(*) filter (where lower(coalesce(result, '')) = 'done')::int as done_jobs,
      coalesce(sum(active_time_sec) filter (where lower(coalesce(result, '')) = 'done'), 0)::bigint as total_nett_printing_time_sec,
      coalesce(sum(duration_sec) filter (where lower(coalesce(result, '')) = 'done'), 0)::bigint as gross_elapsed_time_sec,
      coalesce(sum(printed_area::numeric / 1000000.0) filter (where lower(coalesce(result, '')) = 'done'), 0) as consumed_media_m2,
      coalesce(sum(${inkSql()}) filter (where lower(coalesce(result, '')) = 'done'), 0) as consumed_ink_l
    from public.print_accounting_rows
    where row_type is null or lower(row_type) = 'print'
    group by 1, 2, 3
  `);
  await client.query(`
    create or replace view public.v_reporting_eod_summary as
    select
      report_date,
      sum(done_jobs)::int as done_jobs,
      sum(total_nett_printing_time_sec)::bigint as total_nett_printing_time_sec,
      sum(total_nett_printing_time_sec)::numeric / 60.0 as total_nett_printing_time_minutes,
      sum(total_nett_printing_time_sec)::numeric / 3600.0 as total_nett_printing_time_hours,
      sum(gross_elapsed_time_sec)::numeric / 3600.0 as gross_elapsed_time_hours,
      sum(consumed_media_m2) as consumed_media_m2,
      sum(consumed_ink_l) as consumed_ink_l
    from public.v_reporting_eod_printing_time
    group by report_date
  `);
  schemaReady = true;
}

function accountingDateFilter(column = 'coalesce(ready_at::date, source_date)') {
  return `${column} >= $1::date and ${column} < $2::date`;
}

function accountingDoneWhere() {
  return `lower(coalesce(result, '')) = 'done' and (row_type is null or lower(row_type) = 'print')`;
}

function inkSql() {
  return `((coalesce(ink_cyan, 0) + coalesce(ink_magenta, 0) + coalesce(ink_yellow, 0) + coalesce(ink_black, 0) + coalesce(ink_white, 0))::numeric / 1000000.0)`;
}

async function loadStockSnapshot(client, month) {
  const snapshotMonth = monthStart(month);
  const existing = await client.query(`
    select *
    from public.v_reporting_monthly_stock_snapshot
    where month = $1
    order by stock_type, item_name
  `, [month]);
  if (existing.rows.length) {
    return {
      source: 'snapshot_table',
      rows: existing.rows.map((row) => ({
        month: row.month,
        articleNumber: row.article_number,
        itemName: row.item_name,
        category: row.category,
        stockType: row.stock_type,
        unit: row.unit,
        onHand: num(row.on_hand),
        mediaStockM2: num(row.media_stock_m2_end_of_month),
        inkStockL: num(row.ink_stock_l_end_of_month),
        mediaType: row.media_type,
        printer: row.printer,
      })),
    };
  }

  const itemsResult = await client.query(`select data from public.pg_items`);
  const movesResult = await client.query(
    `select data from public.pg_movements where timestamp < $1::date order by timestamp asc`,
    [nextMonthStart(month)]
  );
  const items = itemsResult.rows.map((row) => row.data || {});
  const movements = movesResult.rows.map((row) => row.data || {});
  return {
    source: 'computed_from_stock_ledger',
    rows: replayStockAt(items, movements, nextMonthStart(month)).map((row) => ({
      month,
      ...row,
    })),
    snapshotMonth,
  };
}

async function queryMonthlyTrend(client, month) {
  const firstMonth = addMonths(month, -5);
  const result = await client.query(`
    with months as (
      select generate_series($1::date, $2::date, interval '1 month')::date as month_start
    ),
    api as (
      select
        date_trunc('month', coalesce(received_at, api_seen_at) at time zone $3)::date as month_start,
        count(distinct coalesce(nullif(order_number, ''), nullif(external_order_id, ''), nullif(customer_order_id, '')))::int as sales_orders
      from public.print_orders_received
      where coalesce(ignored, false) = false
      group by 1
    ),
    files as (
      select
        date_trunc('month', coalesce(queued_date_time, imported_at) at time zone $3)::date as month_start,
        count(*)::int as total_xml_count,
        coalesce(sum(jsonb_array_length(coalesce(print_files, '[]'::jsonb))), 0)::int as total_files,
        coalesce(sum(jsonb_array_length(coalesce(print_files, '[]'::jsonb))) filter (where upper(coalesce(order_type, 'S')) = 'R'), 0)::int as reprint_files,
        coalesce(sum(jsonb_array_length(coalesce(print_files, '[]'::jsonb))) filter (where upper(coalesce(order_type, 'S')) <> 'R'), 0)::int as standard_files
      from public.processed_print_orders
      where coalesce(ignored, false) = false
      group by 1
    ),
    consumption as (
      select
        date_trunc('month', coalesce(ready_at::date, source_date)::timestamp)::date as month_start,
        coalesce(sum(printed_area::numeric / 1000000.0), 0)::float8 as consumed_media_m2,
        coalesce(sum(${inkSql()}), 0)::float8 as consumed_ink_l
      from public.print_accounting_rows
      where ${accountingDoneWhere()}
      group by 1
    )
    select
      to_char(m.month_start, 'YYYY-MM') as month,
      coalesce(api.sales_orders, 0)::int as total_sales_orders,
      coalesce(files.total_xml_count, 0)::int as total_xml_count,
      coalesce(files.total_files, 0)::int as total_files,
      coalesce(files.standard_files, 0)::int as standard_file_count,
      coalesce(files.reprint_files, 0)::int as reprinted_file_count,
      coalesce(consumption.consumed_media_m2, 0)::float8 as total_consumed_media_m2,
      coalesce(consumption.consumed_ink_l, 0)::float8 as total_consumed_ink_l
    from months m
    left join api on api.month_start = m.month_start
    left join files on files.month_start = m.month_start
    left join consumption on consumption.month_start = m.month_start
    order by m.month_start
  `, [monthStart(firstMonth), monthStart(month), TIMEZONE]);
  return result.rows.map(mapMonthlyTrendRow);
}

function mapMonthlyTrendRow(row) {
  const salesOrders = int(row.total_sales_orders);
  const standardFiles = int(row.standard_file_count);
  const totalFiles = int(row.total_files);
  const xmlCount = int(row.total_xml_count);
  return {
    month: row.month,
    totalSalesOrders: salesOrders,
    totalFiles,
    standardFileCount: standardFiles,
    reprintedFileCount: int(row.reprinted_file_count),
    totalConsumedMediaM2: round(row.total_consumed_media_m2, 3),
    totalConsumedInkL: round(row.total_consumed_ink_l, 3),
    avgMediaM2PerSalesOrder: salesOrders ? round(row.total_consumed_media_m2 / salesOrders, 4) : null,
    avgInkLPerSalesOrder: salesOrders ? round(row.total_consumed_ink_l / salesOrders, 5) : null,
    reprintedFilesPerStandardFile: standardFiles ? round(row.reprinted_file_count / standardFiles, 4) : null,
    avgFilesPerSalesOrder: salesOrders ? round(totalFiles / salesOrders, 3) : null,
    avgFilesPerXml: xmlCount ? round(totalFiles / xmlCount, 3) : null,
  };
}

async function loadMonthlyReport(client, options = {}) {
  await ensureReportingSchema(client);
  const month = resolveMonth(options.month);
  const start = monthStart(month);
  const end = nextMonthStart(month);
  const dateParams = [start, end];

  const ordersResult = await client.query(`
      select count(distinct coalesce(nullif(order_number, ''), nullif(external_order_id, ''), nullif(customer_order_id, '')))::int as total_sales_orders
      from public.print_orders_received
      where coalesce(ignored, false) = false
        and (coalesce(received_at, api_seen_at) at time zone $3)::date >= $1::date
        and (coalesce(received_at, api_seen_at) at time zone $3)::date < $2::date
    `, [...dateParams, TIMEZONE]);
  const consumptionResult = await client.query(`
      select
        count(*)::int as done_jobs,
        coalesce(sum(printed_area::numeric / 1000000.0), 0)::float8 as total_consumed_media_m2,
        coalesce(sum(media_length_used::numeric / 10000.0), 0)::float8 as total_consumed_media_length_m,
        coalesce(sum(${inkSql()}), 0)::float8 as total_consumed_ink_l,
        coalesce(sum(active_time_sec), 0)::int as nett_printing_time_sec,
        count(*) filter (where active_time_sec is not null)::int as nett_time_row_count
      from public.print_accounting_rows
      where ${accountingDoneWhere()}
        and ${accountingDateFilter()}
    `, dateParams);
  const printerResult = await client.query(`
      select
        printer_name,
        count(*)::int as done_jobs,
        coalesce(sum(printed_area::numeric / 1000000.0), 0)::float8 as consumed_media_m2,
        coalesce(sum(media_length_used::numeric / 10000.0), 0)::float8 as consumed_media_length_m,
        coalesce(sum(${inkSql()}), 0)::float8 as consumed_ink_l,
        coalesce(sum(active_time_sec), 0)::int as nett_printing_time_sec
      from public.print_accounting_rows
      where ${accountingDoneWhere()}
        and ${accountingDateFilter()}
      group by printer_name
      order by printer_name
    `, dateParams);
  const mediaResult = await client.query(`
      select
        coalesce(nullif(media_type, ''), 'Unknown media') as media_type,
        count(*)::int as done_jobs,
        coalesce(sum(printed_area::numeric / 1000000.0), 0)::float8 as consumed_media_m2,
        coalesce(sum(${inkSql()}), 0)::float8 as consumed_ink_l
      from public.print_accounting_rows
      where ${accountingDoneWhere()}
        and ${accountingDateFilter()}
      group by coalesce(nullif(media_type, ''), 'Unknown media')
      order by consumed_media_m2 desc
    `, dateParams);
  const filesResult = await client.query(`
      select
        count(*)::int as total_xml_count,
        count(*) filter (where upper(coalesce(order_type, 'S')) = 'R')::int as reprint_xml_count,
        coalesce(sum(jsonb_array_length(coalesce(print_files, '[]'::jsonb))), 0)::int as total_files,
        coalesce(sum(jsonb_array_length(coalesce(print_files, '[]'::jsonb))) filter (where upper(coalesce(order_type, 'S')) = 'R'), 0)::int as reprinted_file_count,
        coalesce(sum(jsonb_array_length(coalesce(print_files, '[]'::jsonb))) filter (where upper(coalesce(order_type, 'S')) <> 'R'), 0)::int as standard_file_count
      from public.processed_print_orders
      where coalesce(ignored, false) = false
        and (coalesce(queued_date_time, imported_at) at time zone $3)::date >= $1::date
        and (coalesce(queued_date_time, imported_at) at time zone $3)::date < $2::date
    `, [...dateParams, TIMEZONE]);
  const stock = await loadStockSnapshot(client, month);
  const trend = await queryMonthlyTrend(client, month);

  const orders = ordersResult.rows[0] || {};
  const consumption = consumptionResult.rows[0] || {};
  const files = filesResult.rows[0] || {};
  const totalSalesOrders = int(orders.total_sales_orders);
  const totalFiles = int(files.total_files);
  const totalXml = int(files.total_xml_count);
  const standardFiles = int(files.standard_file_count);
  const reprintFiles = int(files.reprinted_file_count);
  const stockRows = stock.rows || [];
  const mediaStockM2 = stockRows.reduce((sum, row) => sum + num(row.mediaStockM2), 0);
  const inkStockL = stockRows.reduce((sum, row) => sum + num(row.inkStockL), 0);
  const warnings = [];
  if (!stockRows.some((row) => normalizeStockType(row.stockType || row.category) === 'media')) {
    warnings.push('Media stock m2 is unavailable until media stock items include category=Media and m2-per-unit metadata.');
  }
  if (stock.source !== 'snapshot_table') {
    warnings.push('End-of-month stock is computed from the stock movement ledger because no stored month-end snapshot exists for this month.');
  }
  if (int(consumption.nett_time_row_count) < int(consumption.done_jobs)) {
    warnings.push('Nett printing time only includes accounting rows with active_time_sec; gross duration is not presented as nett time.');
  }

  return {
    ok: true,
    month,
    timezone: TIMEZONE,
    period: { start, endExclusive: end },
    metrics: {
      month,
      media_stock_m2_end_of_month: round(mediaStockM2, 3),
      ink_stock_l_end_of_month: round(inkStockL, 3),
      total_consumed_media_m2_including_reprints: round(consumption.total_consumed_media_m2, 3),
      total_consumed_ink_l_including_reprints: round(consumption.total_consumed_ink_l, 3),
      total_sales_orders: totalSalesOrders,
      avg_media_m2_per_sales_order: totalSalesOrders ? round(consumption.total_consumed_media_m2 / totalSalesOrders, 4) : null,
      avg_ink_l_per_sales_order: totalSalesOrders ? round(consumption.total_consumed_ink_l / totalSalesOrders, 5) : null,
      standard_file_count: standardFiles,
      reprinted_file_count: reprintFiles,
      reprinted_files_per_standard_file: standardFiles ? round(reprintFiles / standardFiles, 4) : null,
      total_xml_count: totalXml,
      total_files: totalFiles,
      avg_files_per_sales_order: totalSalesOrders ? round(totalFiles / totalSalesOrders, 3) : null,
      avg_files_per_xml: totalXml ? round(totalFiles / totalXml, 3) : null,
    },
    stock: {
      source: stock.source,
      rows: stockRows,
    },
    consumptionByPrinter: printerResult.rows.map((row) => ({
      printer: row.printer_name || 'Unknown printer',
      doneJobs: int(row.done_jobs),
      consumedMediaM2: round(row.consumed_media_m2, 3),
      consumedMediaLengthM: round(row.consumed_media_length_m, 3),
      consumedInkL: round(row.consumed_ink_l, 4),
      nettPrintingTimeHours: round(row.nett_printing_time_sec / 3600, 3),
    })),
    consumptionByMediaType: mediaResult.rows.map((row) => ({
      mediaType: row.media_type,
      doneJobs: int(row.done_jobs),
      consumedMediaM2: round(row.consumed_media_m2, 3),
      consumedInkL: round(row.consumed_ink_l, 4),
    })),
    trend,
    warnings,
    generatedAt: new Date().toISOString(),
  };
}

async function loadIncomingPeriodSummary(client, period) {
  const params = [period.start, period.end, TIMEZONE];
  const result = await client.query(`
    with incoming as (
      select *
      from public.print_orders_received i
      where coalesce(i.ignored, false) = false
        and (coalesce(i.received_at, i.api_seen_at) at time zone $3)::date >= $1::date
        and (coalesce(i.received_at, i.api_seen_at) at time zone $3)::date < $2::date
    ),
    incoming_keys as (
      select
        external_order_id,
        order_number,
        customer_order_id,
        coalesce(nullif(order_number, ''), nullif(external_order_id, ''), nullif(customer_order_id, '')) as sales_order_key
      from incoming
    ),
    matched_xml as (
      select distinct p.*
      from public.processed_print_orders p
      join incoming_keys i on p.order_name = any(array_remove(array[i.order_number, i.external_order_id, i.customer_order_id], null))
      where coalesce(p.ignored, false) = false
        and upper(coalesce(p.order_type, 'S')) <> 'R'
    ),
    matched_orders as (
      select distinct i.sales_order_key
      from incoming_keys i
      join public.processed_print_orders p on p.order_name = any(array_remove(array[i.order_number, i.external_order_id, i.customer_order_id], null))
      where coalesce(p.ignored, false) = false
        and upper(coalesce(p.order_type, 'S')) <> 'R'
    )
    select
      (select count(distinct sales_order_key)::int from incoming_keys) as api_received_sales_orders,
      (select count(*)::int from matched_xml) as api_received_xml_count,
      (select coalesce(sum(jsonb_array_length(coalesce(print_files, '[]'::jsonb))), 0)::int from matched_xml) as api_received_file_count,
      (select count(*)::int from matched_xml) as processed_xml_count,
      (select count(distinct sales_order_key)::int from incoming_keys) as expected_count,
      (select count(distinct sales_order_key)::int from incoming_keys where sales_order_key not in (select sales_order_key from matched_orders)) as missing_count
  `, params);
  const row = result.rows[0] || {};
  return {
    apiReceivedSalesOrders: int(row.api_received_sales_orders),
    apiReceivedXmlCount: int(row.api_received_xml_count),
    apiReceivedFileCount: int(row.api_received_file_count),
    processedXmlCount: int(row.processed_xml_count),
    expectedCount: int(row.expected_count),
    missingCount: int(row.missing_count),
    waitingCount: int(row.missing_count),
  };
}

async function loadEodProductionSummary(client, reportDate) {
  const nextDay = addDays(reportDate, 1);
  const params = [reportDate, nextDay, TIMEZONE];
  const filesResult = await client.query(`
      select
        count(*)::int as total_xml_count,
        coalesce(sum(jsonb_array_length(coalesce(print_files, '[]'::jsonb))), 0)::int as total_files,
        coalesce(sum(jsonb_array_length(coalesce(print_files, '[]'::jsonb))) filter (where upper(coalesce(order_type, 'S')) = 'R'), 0)::int as reprint_file_count,
        coalesce(sum(jsonb_array_length(coalesce(print_files, '[]'::jsonb))) filter (where upper(coalesce(order_type, 'S')) <> 'R'), 0)::int as standard_file_count
      from public.processed_print_orders
      where coalesce(ignored, false) = false
        and (coalesce(queued_date_time, imported_at) at time zone $3)::date >= $1::date
        and (coalesce(queued_date_time, imported_at) at time zone $3)::date < $2::date
    `, params);
  const accountingResult = await client.query(`
      select
        count(*)::int as done_jobs,
        count(*) filter (where active_time_sec is not null)::int as nett_time_row_count,
        coalesce(sum(active_time_sec), 0)::int as nett_printing_time_sec,
        coalesce(sum(duration_sec), 0)::int as gross_elapsed_time_sec,
        coalesce(sum(printed_area::numeric / 1000000.0), 0)::float8 as consumed_media_m2,
        coalesce(sum(media_length_used::numeric / 10000.0), 0)::float8 as consumed_media_length_m,
        coalesce(sum(${inkSql()}), 0)::float8 as consumed_ink_l
      from public.print_accounting_rows
      where ${accountingDoneWhere()}
        and ${accountingDateFilter()}
    `, [reportDate, nextDay]);
  const printerResult = await client.query(`
      select
        printer_name,
        count(*)::int as done_jobs,
        coalesce(sum(active_time_sec), 0)::int as nett_printing_time_sec,
        coalesce(sum(duration_sec), 0)::int as gross_elapsed_time_sec,
        coalesce(sum(printed_area::numeric / 1000000.0), 0)::float8 as consumed_media_m2,
        coalesce(sum(${inkSql()}), 0)::float8 as consumed_ink_l
      from public.print_accounting_rows
      where ${accountingDoneWhere()}
        and ${accountingDateFilter()}
      group by printer_name
      order by printer_name
    `, [reportDate, nextDay]);
  const mediaResult = await client.query(`
      select
        coalesce(nullif(media_type, ''), 'Unknown media') as media_type,
        count(*)::int as done_jobs,
        coalesce(sum(active_time_sec), 0)::int as nett_printing_time_sec,
        coalesce(sum(printed_area::numeric / 1000000.0), 0)::float8 as consumed_media_m2,
        coalesce(sum(${inkSql()}), 0)::float8 as consumed_ink_l
      from public.print_accounting_rows
      where ${accountingDoneWhere()}
        and ${accountingDateFilter()}
      group by coalesce(nullif(media_type, ''), 'Unknown media')
      order by consumed_media_m2 desc
    `, [reportDate, nextDay]);

  const files = filesResult.rows[0] || {};
  const accounting = accountingResult.rows[0] || {};
  return {
    files: {
      totalXmlCount: int(files.total_xml_count),
      totalFiles: int(files.total_files),
      reprintFileCount: int(files.reprint_file_count),
      standardFileCount: int(files.standard_file_count),
    },
    accounting: {
      doneJobs: int(accounting.done_jobs),
      nettTimeRowCount: int(accounting.nett_time_row_count),
      totalNettPrintingTimeMinutes: round(accounting.nett_printing_time_sec / 60, 2),
      totalNettPrintingTimeHours: round(accounting.nett_printing_time_sec / 3600, 3),
      grossElapsedTimeHours: round(accounting.gross_elapsed_time_sec / 3600, 3),
      consumedMediaM2: round(accounting.consumed_media_m2, 3),
      consumedMediaLengthM: round(accounting.consumed_media_length_m, 3),
      consumedInkL: round(accounting.consumed_ink_l, 4),
    },
    nettPrintingTimeByPrinter: printerResult.rows.map((row) => ({
      printer: row.printer_name || 'Unknown printer',
      doneJobs: int(row.done_jobs),
      nettPrintingTimeHours: round(row.nett_printing_time_sec / 3600, 3),
      grossElapsedTimeHours: round(row.gross_elapsed_time_sec / 3600, 3),
      consumedMediaM2: round(row.consumed_media_m2, 3),
      consumedInkL: round(row.consumed_ink_l, 4),
    })),
    nettPrintingTimeByMediaType: mediaResult.rows.map((row) => ({
      mediaType: row.media_type,
      doneJobs: int(row.done_jobs),
      nettPrintingTimeHours: round(row.nett_printing_time_sec / 3600, 3),
      consumedMediaM2: round(row.consumed_media_m2, 3),
      consumedInkL: round(row.consumed_ink_l, 4),
    })),
  };
}

async function loadEodReport(client, options = {}) {
  await ensureReportingSchema(client);
  const reportDate = resolveReportDate(options.date);
  const incomingPeriod = incomingPeriodForReportDate(reportDate);
  const incoming = await loadIncomingPeriodSummary(client, incomingPeriod);
  const production = await loadEodProductionSummary(client, reportDate);

  const warnings = [
    'API intake uses the previous closed business period, not same-day incoming orders.',
  ];
  if (production.accounting.nettTimeRowCount < production.accounting.doneJobs) {
    warnings.push('Nett printing time uses active_time_sec only; rows without active time are excluded from nett time and shown only in gross elapsed time.');
  }
  const avgFilesPerSalesOrder = incoming.apiReceivedSalesOrders
    ? round(incoming.apiReceivedFileCount / incoming.apiReceivedSalesOrders, 3)
    : null;

  return {
    ok: true,
    timezone: TIMEZONE,
    report_date: reportDate,
    incoming_period_start: incomingPeriod.start,
    incoming_period_end: addDays(incomingPeriod.end, -1),
    incomingPeriod,
    api_received_sales_orders: incoming.apiReceivedSalesOrders,
    api_received_xml_count: incoming.apiReceivedXmlCount,
    api_received_file_count: incoming.apiReceivedFileCount,
    processed_xml_count: incoming.processedXmlCount,
    waiting_count: incoming.waitingCount,
    expected_count: incoming.expectedCount,
    missing_count: incoming.missingCount,
    reprint_file_count: production.files.reprintFileCount,
    standard_file_count: production.files.standardFileCount,
    avg_files_per_sales_order: avgFilesPerSalesOrder,
    nett_printing_time_hours: production.accounting.totalNettPrintingTimeHours,
    consumed_media_m2: production.accounting.consumedMediaM2,
    consumed_ink_l: production.accounting.consumedInkL,
    production,
    statusBreakdown: [
      { status: 'processed', count: incoming.processedXmlCount },
      { status: 'waiting_or_missing', count: incoming.missingCount },
    ],
    warnings,
    generatedAt: new Date().toISOString(),
  };
}

module.exports = {
  TIMEZONE,
  defaultCompletedMonth,
  incomingPeriodForReportDate,
  loadEodReport,
  loadMonthlyReport,
  resolveMonth,
  resolveReportDate,
};
