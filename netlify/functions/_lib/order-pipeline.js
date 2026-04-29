'use strict';

const { ensurePrintOrdersTable } = require('./postpurchase-orders');
const { ensureProcessedPrintOrderTables } = require('./processed-print-orders');

function cleanString(value) {
  if (value == null) return null;
  const trimmed = String(value).trim();
  return trimmed || null;
}

function toIso(value) {
  return value instanceof Date ? value.toISOString() : String(value || '');
}

async function ensureOrderPipelineView(client) {
  await ensurePrintOrdersTable(client);
  await ensureProcessedPrintOrderTables(client);
  await client.query(`drop view if exists v_print_order_pipeline`);
  await client.query(`
    create view v_print_order_pipeline as
    with reprint_summary as (
      select
        order_id,
        count(*)::int as reprint_request_count,
        count(*) filter (where status = 'pending')::int as reprint_pending_count,
        count(*) filter (where status in ('completed', 'resolved', 'done'))::int as reprint_completed_count,
        (array_agg(status order by requested_at desc, id desc))[1] as latest_reprint_status
      from processed_order_reprint_requests
      group by order_id
    ),
    incoming_pipeline as (
      select
        i.order_number,
        i.external_order_id,
        i.customer_order_id,
        i.received_at,
        i.api_seen_at,
        p.id as processed_order_id,
        p.order_name as processed_order_name,
        p.xml_file_name,
        p.queued_date_time as processed_at,
        p.queued_date_time,
        p.workflow_name,
        p.order_type,
        p.print_files,
        p.source_xml_path,
        p.source_month
      from print_orders_received i
      left join lateral (
        select p.*
        from processed_print_orders p
        where p.order_name = any(array_remove(array[
          i.order_number,
          i.external_order_id,
          i.customer_order_id
        ], null))
        order by case
          when p.order_name = i.order_number then 1
          when p.order_name = i.external_order_id then 2
          when p.order_name = i.customer_order_id then 3
          else 4
        end, p.queued_date_time desc nulls last, p.id desc
        limit 1
      ) p on true
    ),
    processed_orphans as (
      select
        p.order_name as order_number,
        null::text as external_order_id,
        null::text as customer_order_id,
        null::timestamptz as received_at,
        null::timestamptz as api_seen_at,
        p.id as processed_order_id,
        p.order_name as processed_order_name,
        p.xml_file_name,
        p.queued_date_time as processed_at,
        p.queued_date_time,
        p.workflow_name,
        p.order_type,
        p.print_files,
        p.source_xml_path,
        p.source_month
      from processed_print_orders p
      where not exists (
        select 1
        from print_orders_received i
        where p.order_name = any(array_remove(array[
          i.order_number,
          i.external_order_id,
          i.customer_order_id
        ], null))
      )
    ),
    pipeline_rows as (
      select * from incoming_pipeline
      union all
      select * from processed_orphans
    )
    select
      coalesce(pr.order_number, pr.processed_order_name) as order_number,
      pr.external_order_id,
      pr.customer_order_id,
      pr.received_at,
      pr.api_seen_at,
      pr.processed_order_id,
      pr.processed_order_name,
      pr.xml_file_name,
      pr.processed_at,
      pr.queued_date_time,
      pr.workflow_name,
      pr.order_type,
      pr.print_files,
      pr.source_xml_path,
      pr.source_month,
      coalesce(r.reprint_request_count, 0) as reprint_request_count,
      coalesce(r.reprint_pending_count, 0) as reprint_pending_count,
      coalesce(r.reprint_completed_count, 0) as reprint_completed_count,
      r.latest_reprint_status,
      coalesce(r.reprint_pending_count, 0) > 0 as reprint_pending,
      case
        when coalesce(r.reprint_pending_count, 0) > 0 then 'reprint_pending'
        when pr.external_order_id is not null and pr.processed_order_id is not null then 'processed'
        when pr.external_order_id is not null and pr.processed_order_id is null then 'received_only'
        when pr.external_order_id is null and pr.processed_order_id is not null then 'processed_without_received'
        else 'received_only'
      end as pipeline_status
    from pipeline_rows pr
    left join reprint_summary r on r.order_id = pr.processed_order_id
  `);
}

function mapPipelineRow(row) {
  const files = Array.isArray(row.print_files) ? row.print_files : [];
  return {
    orderName: row.order_number || row.processed_order_name || row.external_order_id || '',
    externalOrderId: row.external_order_id || '',
    customerOrderId: row.customer_order_id || '',
    receivedAt: toIso(row.received_at),
    apiSeenAt: toIso(row.api_seen_at),
    id: row.processed_order_id == null ? null : Number(row.processed_order_id),
    processedOrderId: row.processed_order_id == null ? null : Number(row.processed_order_id),
    processedOrderName: row.processed_order_name || '',
    xmlFileName: row.xml_file_name || '',
    processedAt: toIso(row.processed_at || row.queued_date_time),
    queuedDateTime: toIso(row.queued_date_time || row.processed_at),
    workflowName: row.workflow_name || '',
    orderType: row.order_type || '',
    printFiles: files,
    sourceXmlPath: row.source_xml_path || '',
    sourceMonth: row.source_month || '',
    reprintRequestCount: Number(row.reprint_request_count) || 0,
    reprintPendingCount: Number(row.reprint_pending_count) || 0,
    reprintCompletedCount: Number(row.reprint_completed_count) || 0,
    latestReprintStatus: row.latest_reprint_status || '',
    reprintPending: Boolean(row.reprint_pending),
    pipelineStatus: row.pipeline_status || 'received_only',
  };
}

function isIsoDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''));
}

function addDateRangeFilter(where, params, options) {
  const preset = cleanString(options.datePreset || options.date_preset) || 'this_month';
  const from = cleanString(options.from);
  const to = cleanString(options.to);
  const dateExpr = `(coalesce(processed_at, queued_date_time, received_at, api_seen_at) at time zone 'Europe/Prague')::date`;

  if (preset === 'custom') {
    if (isIsoDate(from)) {
      params.push(from);
      where.push(`${dateExpr} >= $${params.length}::date`);
    }
    if (isIsoDate(to)) {
      params.push(to);
      where.push(`${dateExpr} <= $${params.length}::date`);
    }
    return;
  }

  const ranges = {
    today: `${dateExpr} = (now() at time zone 'Europe/Prague')::date`,
    yesterday: `${dateExpr} = ((now() at time zone 'Europe/Prague')::date - interval '1 day')::date`,
    this_week: `${dateExpr} >= date_trunc('week', now() at time zone 'Europe/Prague')::date and ${dateExpr} < (date_trunc('week', now() at time zone 'Europe/Prague') + interval '1 week')::date`,
    last_week: `${dateExpr} >= (date_trunc('week', now() at time zone 'Europe/Prague') - interval '1 week')::date and ${dateExpr} < date_trunc('week', now() at time zone 'Europe/Prague')::date`,
    this_month: `${dateExpr} >= date_trunc('month', now() at time zone 'Europe/Prague')::date and ${dateExpr} < (date_trunc('month', now() at time zone 'Europe/Prague') + interval '1 month')::date`,
    last_month: `${dateExpr} >= (date_trunc('month', now() at time zone 'Europe/Prague') - interval '1 month')::date and ${dateExpr} < date_trunc('month', now() at time zone 'Europe/Prague')::date`,
  };

  if (ranges[preset]) where.push(`(${ranges[preset]})`);
}

function addReprintFilter(where, value) {
  const reprint = cleanString(value) || 'all';
  if (reprint === 'has_reprint') {
    where.push(`coalesce(reprint_request_count, 0) > 0`);
  } else if (reprint === 'pending') {
    where.push(`coalesce(reprint_pending_count, 0) > 0`);
  } else if (reprint === 'completed') {
    where.push(`coalesce(reprint_completed_count, 0) > 0`);
  } else if (reprint === 'none') {
    where.push(`coalesce(reprint_request_count, 0) = 0`);
  }
}

async function listOrderPipeline(client, options = {}) {
  await ensureOrderPipelineView(client);
  const limit = Math.min(500, Math.max(1, Number(options.limit) || 500));
  const month = cleanString(options.month);
  const search = cleanString(options.q || options.search);
  const params = [limit];
  const where = [];

  addDateRangeFilter(where, params, options);
  addReprintFilter(where, options.reprint);

  if (month) {
    params.push(month);
    where.push(`(
      source_month = $${params.length}
      or to_char(coalesce(processed_at, received_at, api_seen_at), 'YYYY-MM') = $${params.length}
    )`);
  }
  if (search) {
    params.push(`%${search}%`);
    where.push(`(
      coalesce(order_number, '') ilike $${params.length}
      or coalesce(external_order_id, '') ilike $${params.length}
      or coalesce(customer_order_id, '') ilike $${params.length}
      or coalesce(xml_file_name, '') ilike $${params.length}
      or coalesce(workflow_name, '') ilike $${params.length}
      or print_files::text ilike $${params.length}
    )`);
  }

  const result = await client.query(
    `
      select *
      from v_print_order_pipeline
      ${where.length ? `where ${where.join(' and ')}` : ''}
      order by coalesce(received_at, api_seen_at, processed_at, queued_date_time) desc nulls last, order_number desc
      limit $1
    `,
    params
  );
  return result.rows.map(mapPipelineRow);
}

async function listPipelineMonths(client) {
  await ensureOrderPipelineView(client);
  const result = await client.query(`
    select to_char(coalesce(processed_at, received_at, api_seen_at), 'YYYY-MM') as month
    from v_print_order_pipeline
    where coalesce(processed_at, received_at, api_seen_at) is not null
    group by month
    order by month desc
    limit 36
  `);
  return result.rows.map((row) => row.month).filter(Boolean);
}

module.exports = {
  ensureOrderPipelineView,
  listOrderPipeline,
  listPipelineMonths,
};
