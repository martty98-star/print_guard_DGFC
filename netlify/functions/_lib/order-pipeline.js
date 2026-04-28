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
  await client.query(`
    create or replace view v_print_order_pipeline as
    with pending_reprints as (
      select
        order_id,
        true as has_pending_reprint
      from processed_order_reprint_requests
      where status = 'pending'
      group by order_id
    )
    select
      coalesce(i.order_number, p.order_name) as order_number,
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
      p.source_month,
      coalesce(r.has_pending_reprint, false) as reprint_pending,
      case
        when coalesce(r.has_pending_reprint, false) then 'reprint_pending'
        when i.external_order_id is not null and p.id is not null then 'processed'
        when i.external_order_id is not null and p.id is null then 'received_only'
        when i.external_order_id is null and p.id is not null then 'processed_without_received'
        else 'received_only'
      end as pipeline_status
    from print_orders_received i
    full join processed_print_orders p
      on p.order_name = i.order_number
      or p.order_name = i.external_order_id
      or p.order_name = i.customer_order_id
    left join pending_reprints r on r.order_id = p.id
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
    reprintPending: Boolean(row.reprint_pending),
    pipelineStatus: row.pipeline_status || 'received_only',
  };
}

async function listOrderPipeline(client, options = {}) {
  await ensureOrderPipelineView(client);
  const limit = Math.min(500, Math.max(1, Number(options.limit) || 500));
  const month = cleanString(options.month);
  const search = cleanString(options.search);
  const params = [limit];
  const where = [];

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
      order by coalesce(processed_at, received_at, api_seen_at) desc nulls last, order_number desc
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
