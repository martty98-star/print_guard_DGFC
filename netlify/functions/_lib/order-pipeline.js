'use strict';

const { ensurePrintOrdersTable } = require('./postpurchase-orders');
const { ensureProcessedPrintOrderTables } = require('./processed-print-orders');

let orderPipelineViewReady = false;
const GLOBAL_STATS_TTL_MS = 45 * 1000;
let globalStatsCache = null;

function cleanString(value) {
  if (value == null) return null;
  const trimmed = String(value).trim();
  return trimmed || null;
}

function toIso(value) {
  return value instanceof Date ? value.toISOString() : String(value || '');
}

function normalizeSearchTerm(value) {
  const cleaned = cleanString(value);
  return cleaned ? cleaned.toLowerCase().replace(/[\s_-]+/g, '') : null;
}

function stripXmlExtension(value) {
  return String(value || '').replace(/\.xml$/i, '');
}

function stripReprintSuffix(value) {
  return String(value || '').replace(/([\s_-]*reprint.*)$/i, '');
}

function stripTechnicalSuffixes(value) {
  return String(value || '')
    .replace(/\.xml$/i, '')
    .replace(/([\s_-]*reprint.*)$/i, '')
    .replace(/([\s_-]+(?:retry|copy|duplicate|processed|submittool|xml|api|v)\d*)+$/i, '')
    .trim();
}

function normalizeOrderIdentityCandidate(value) {
  const raw = cleanString(value);
  if (!raw) return null;
  if (/[\\/]/.test(raw) || /\.xml$/i.test(raw)) return null;

  const cleaned = stripTechnicalSuffixes(raw);
  const prefixed = cleaned.match(/^ps[\s_-]*(\d{6,})$/i);
  if (prefixed) return `PS${prefixed[1]}`;

  const numeric = cleaned.match(/^(\d{6,})$/);
  if (numeric) return numeric[1];

  return null;
}

function getCanonicalOrderIdentity(row) {
  if (!row || typeof row !== 'object') return normalizeOrderIdentityCandidate(row);
  const internalIds = new Set([
    row.id,
    row.processed_order_id,
    row.processedOrderId,
  ].map(cleanString).filter(Boolean));
  const candidates = [
    row.order_number,
    row.external_order_id,
    row.customer_order_id,
    row.received_order_id,
    row.processed_order_name,
    row.orderName,
    row.orderNumber,
    row.externalOrderId,
    row.customerOrderId,
    row.receivedOrderId,
    row.processedOrderName,
  ];
  for (const candidate of candidates) {
    const raw = cleanString(candidate);
    if (raw && internalIds.has(raw)) continue;
    const identity = normalizeOrderIdentityCandidate(candidate);
    if (identity && !internalIds.has(identity)) return identity;
  }
  return null;
}

function isOrderLikeSearch(value) {
  const normalized = normalizeSearchTerm(stripXmlExtension(stripReprintSuffix(value)));
  return Boolean(normalized && /^(ps|pod)?\d{4,}$/.test(normalized));
}

function orderSearchCandidates(value) {
  const raw = cleanString(value);
  if (!raw) return { exact: [], normalized: [] };
  const base = stripReprintSuffix(stripXmlExtension(raw)).trim();
  const compact = normalizeSearchTerm(base);
  const exact = new Set([base.toLowerCase()]);
  const normalized = new Set(compact ? [compact] : []);
  const digits = compact && compact.match(/^(?:ps|pod)?(\d{4,})$/);
  if (digits) {
    exact.add(digits[1]);
    exact.add(`ps${digits[1]}`);
    exact.add(`pod${digits[1]}`);
    normalized.add(digits[1]);
    normalized.add(`ps${digits[1]}`);
    normalized.add(`pod${digits[1]}`);
  }
  return {
    exact: Array.from(exact).filter(Boolean),
    normalized: Array.from(normalized).filter(Boolean),
  };
}

function normalizeOrderType(value) {
  const normalized = String(value || '').trim().toUpperCase();
  if (normalized === 'S') return 'S';
  if (normalized === 'C') return 'C';
  if (normalized === 'R') return 'R';
  return '';
}

function clampLimit(value) {
  return Math.min(100, Math.max(1, Number(value) || 50));
}

function clampOffset(value) {
  return Math.max(0, Number(value) || 0);
}

function pipelineDateExpr() {
  return `(coalesce(processed_at, queued_date_time, received_at, api_seen_at, latest_reprint_record_at) at time zone 'Europe/Prague')::date`;
}

function pipelineIncomingDateExpr() {
  return `(coalesce(received_at, api_seen_at) at time zone 'Europe/Prague')::date`;
}

function isDefaultOrderPipelineScope(options = {}) {
  const preset = cleanString(options.datePreset || options.date_preset) || 'this_month';
  return !cleanString(options.q || options.search)
    && !cleanString(options.month)
    && !cleanString(options.from)
    && !cleanString(options.to)
    && (cleanString(options.status) || 'all') === 'all'
    && (cleanString(options.reprint) || 'all') === 'all'
    && preset === 'this_month';
}

function pipelineSortExpr(options = {}) {
  if (isDefaultOrderPipelineScope(options)) {
    return `coalesce(received_at, api_seen_at) desc nulls last,
        nullif(regexp_replace(coalesce(order_number, ''), '[^0-9]+', '', 'g'), '')::bigint desc nulls last,
        order_number desc`;
  }
  return `case
          when pipeline_status = 'received_only' then 0
          when pipeline_status = 'processed_without_received' then 1
          when pipeline_status = 'reprint_pending' then 2
          else 3
        end,
        coalesce(processed_at, queued_date_time, received_at, api_seen_at, latest_reprint_record_at) desc nulls last,
        nullif(regexp_replace(coalesce(order_number, ''), '[^0-9]+', '', 'g'), '')::bigint desc nulls last,
        order_number desc`;
}

function parentMatchKeyExpr(alias, columnName) {
  return `regexp_replace(lower(coalesce(${alias}.${columnName}, '')), '[[:space:]_-]+', '', 'g')`;
}

function orderIdentityKeySql(expression) {
  return `regexp_replace(
          regexp_replace(
            regexp_replace(lower(coalesce(${expression}, '')), '^.*[\\\\/]', ''),
            '\\.xml$', '', 'i'
          ),
          '([[:space:]_-]*(reprint.*|retry[0-9]*|copy[0-9]*|duplicate[0-9]*|processed|submittool|xml|api|v[0-9]*))$', '', 'i'
        )`;
}

function pipelineIdentityKeySql(alias = '') {
  const prefix = alias ? `${alias}.` : '';
  return `coalesce(
          nullif(regexp_replace(${orderIdentityKeySql(`${prefix}order_number`)}, '[[:space:]_-]+', '', 'g'), ''),
          nullif(regexp_replace(${orderIdentityKeySql(`${prefix}external_order_id`)}, '[[:space:]_-]+', '', 'g'), ''),
          nullif(regexp_replace(${orderIdentityKeySql(`${prefix}customer_order_id`)}, '[[:space:]_-]+', '', 'g'), ''),
          nullif(regexp_replace(${orderIdentityKeySql(`${prefix}processed_order_name`)}, '[[:space:]_-]+', '', 'g'), '')
        )`;
}

function defaultPipelineWhereSql() {
  return `coalesce(received_at, api_seen_at) is not null
      and pipeline_status <> 'processed_without_received'
      and (
        coalesce(order_number, '') ~* '^(ps)?[0-9]{6,}([_-]*reprint.*)?$'
        or coalesce(external_order_id, '') ~* '^(ps)?[0-9]{6,}([_-]*reprint.*)?$'
        or coalesce(customer_order_id, '') ~* '^(ps)?[0-9]{6,}([_-]*reprint.*)?$'
      )`;
}

function reprintParentMatchKeySql(alias) {
  return `coalesce(
          nullif(regexp_replace(regexp_replace(lower(coalesce(${alias}.order_name, '')), '([[:space:]_-]*reprint.*)$', '', 'i'), '[[:space:]_-]+', '', 'g'), ''),
          nullif(regexp_replace(regexp_replace(lower(coalesce(${alias}.xml_file_name, '')), '([[:space:]_-]*reprint.*|\\.xml)$', '', 'i'), '[[:space:]_-]+', '', 'g'), '')
        )`;
}

// Common list/stat requests do not need the full reprint XML payload. Keep them
// on base tables so each request does not rebuild the expensive full view.
function buildFastPipelineBaseCte() {
  return `
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
        p.source_month,
        i.admin_status as received_admin_status,
        i.admin_note as received_admin_note,
        i.admin_updated_at as received_admin_updated_at,
        p.admin_status as processed_admin_status,
        p.admin_note as processed_admin_note,
        p.admin_updated_at as processed_admin_updated_at
      from print_orders_received i
      left join lateral (
        select p.*
        from processed_print_orders p
        where coalesce(p.ignored, false) = false
          and upper(coalesce(p.order_type, 'S')) <> 'R'
          and p.order_name in (i.order_number, i.external_order_id, i.customer_order_id)
        order by case
          when p.order_name = i.order_number then 1
          when p.order_name = i.external_order_id then 2
          when p.order_name = i.customer_order_id then 3
          else 4
        end, p.queued_date_time desc nulls last, p.id desc
        limit 1
      ) p on true
      where coalesce(i.ignored, false) = false
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
        p.source_month,
        null::text as received_admin_status,
        null::text as received_admin_note,
        null::timestamptz as received_admin_updated_at,
        p.admin_status as processed_admin_status,
        p.admin_note as processed_admin_note,
        p.admin_updated_at as processed_admin_updated_at
      from processed_print_orders p
      where coalesce(p.ignored, false) = false
        and upper(coalesce(p.order_type, 'S')) <> 'R'
        and not exists (
          select 1
          from print_orders_received i
          where i.order_number = p.order_name
             or i.external_order_id = p.order_name
             or i.customer_order_id = p.order_name
        )
    ),
    pipeline_rows as (
      select * from incoming_pipeline
      union all
      select * from processed_orphans
    ),
    pipeline_base as (
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
        coalesce(pr.received_admin_status, pr.processed_admin_status) as admin_status,
        coalesce(pr.received_admin_note, pr.processed_admin_note) as admin_note,
        coalesce(pr.received_admin_updated_at, pr.processed_admin_updated_at) as admin_updated_at,
        0::int as reprint_record_count,
        '[]'::jsonb as reprint_records,
        null::timestamptz as latest_reprint_record_at,
        coalesce(r.reprint_request_count, 0) as reprint_request_count,
        coalesce(r.reprint_pending_count, 0) as reprint_pending_count,
        coalesce(r.reprint_completed_count, 0) as reprint_completed_count,
        r.latest_reprint_status,
        coalesce(r.reprint_pending_count, 0) > 0 as reprint_pending,
        false as is_reprint_record,
        case
          when coalesce(pr.received_admin_status, pr.processed_admin_status) = 'cancelled' then 'cancelled'
          when coalesce(r.reprint_pending_count, 0) > 0 then 'reprint_pending'
          when pr.external_order_id is not null and pr.processed_order_id is not null then 'processed'
          when pr.external_order_id is not null and pr.processed_order_id is null then 'received_only'
          when pr.external_order_id is null and pr.processed_order_id is not null then 'processed_without_received'
          else 'received_only'
        end as pipeline_status
      from pipeline_rows pr
      left join reprint_summary r on r.order_id = pr.processed_order_id
    )
  `;
}

function requiresFullReprintView(options = {}) {
  return options && options.deepScan === true;
}

async function ensureOrderPipelineBaseTables(client) {
  await ensurePrintOrdersTable(client);
  await ensureProcessedPrintOrderTables(client);
}

async function ensureOrderPipelineView(client) {
  if (orderPipelineViewReady) return;
  await ensureOrderPipelineBaseTables(client);
  await client.query(`
    create or replace view v_print_order_pipeline as
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
    processed_normal as (
      select p.*
      from processed_print_orders p
      where upper(coalesce(p.order_type, 'S')) <> 'R'
        and coalesce(p.ignored, false) = false
    ),
    processed_reprints as (
      select distinct on (coalesce(nullif(source_xml_path, ''), nullif(xml_file_name, ''), id::text))
        p.*,
        coalesce(
          nullif(regexp_replace(regexp_replace(lower(coalesce(p.order_name, '')), '([[:space:]_-]*reprint.*)$', '', 'i'), '[[:space:]_-]+', '', 'g'), ''),
          nullif(regexp_replace(regexp_replace(lower(coalesce(p.xml_file_name, '')), '([[:space:]_-]*reprint.*|\\.xml)$', '', 'i'), '[[:space:]_-]+', '', 'g'), '')
        ) as parent_match_key
      from processed_print_orders p
      where upper(coalesce(p.order_type, 'S')) = 'R'
        and coalesce(p.ignored, false) = false
      order by coalesce(nullif(source_xml_path, ''), nullif(xml_file_name, ''), id::text),
        queued_date_time desc nulls last,
        updated_at desc,
        id desc
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
        p.source_month,
        i.admin_status as received_admin_status,
        i.admin_note as received_admin_note,
        i.admin_updated_at as received_admin_updated_at,
        p.admin_status as processed_admin_status,
        p.admin_note as processed_admin_note,
        p.admin_updated_at as processed_admin_updated_at
      from print_orders_received i
      left join lateral (
        select p.*
        from processed_normal p
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
      where coalesce(i.ignored, false) = false
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
        p.source_month,
        null::text as received_admin_status,
        null::text as received_admin_note,
        null::timestamptz as received_admin_updated_at,
        p.admin_status as processed_admin_status,
        p.admin_note as processed_admin_note,
        p.admin_updated_at as processed_admin_updated_at
      from processed_normal p
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
    ),
    pipeline_with_reprints as (
      select
        pr.*,
        coalesce(rr.reprint_record_count, 0) as reprint_record_count,
        coalesce(rr.reprint_records, '[]'::jsonb) as reprint_records,
        rr.latest_reprint_record_at
      from pipeline_rows pr
      left join lateral (
        select
          count(*)::int as reprint_record_count,
          max(rp.queued_date_time) as latest_reprint_record_at,
          jsonb_agg(
            jsonb_build_object(
              'id', rp.id,
              'orderName', rp.order_name,
              'xmlFileName', rp.xml_file_name,
              'status', rp.status,
              'orderType', 'R',
              'processedAt', rp.queued_date_time,
              'queuedDateTime', rp.queued_date_time,
              'sourceXmlPath', rp.source_xml_path,
              'printFiles', rp.print_files,
              'isFullReprint', jsonb_array_length(coalesce(rp.print_files, '[]'::jsonb)) > 1
            )
            order by rp.queued_date_time desc nulls last, rp.id desc
          ) as reprint_records
        from processed_reprints rp
        where rp.parent_match_key = any(array_remove(array[
          regexp_replace(lower(coalesce(pr.order_number, '')), '[[:space:]_-]+', '', 'g'),
          regexp_replace(lower(coalesce(pr.processed_order_name, '')), '[[:space:]_-]+', '', 'g'),
          regexp_replace(lower(coalesce(pr.external_order_id, '')), '[[:space:]_-]+', '', 'g'),
          regexp_replace(lower(coalesce(pr.customer_order_id, '')), '[[:space:]_-]+', '', 'g')
        ], ''))
        or exists (
          select 1
          from jsonb_array_elements(coalesce(pr.print_files, '[]'::jsonb)) parent_file
          join jsonb_array_elements(coalesce(rp.print_files, '[]'::jsonb)) reprint_file
            on lower(coalesce(parent_file->>'printFilePath', '')) = lower(coalesce(reprint_file->>'printFilePath', ''))
            or regexp_replace(lower(regexp_replace(coalesce(parent_file->>'printFilePath', ''), '^.*[\\\\/]', '')), '[[:space:]_-]+', '', 'g')
              = regexp_replace(lower(regexp_replace(coalesce(reprint_file->>'printFilePath', ''), '^.*[\\\\/]', '')), '[[:space:]_-]+', '', 'g')
          where coalesce(parent_file->>'printFilePath', '') <> ''
        )
      ) rr on true
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
      coalesce(pr.received_admin_status, pr.processed_admin_status) as admin_status,
      coalesce(pr.received_admin_note, pr.processed_admin_note) as admin_note,
      coalesce(pr.received_admin_updated_at, pr.processed_admin_updated_at) as admin_updated_at,
      pr.reprint_record_count,
      pr.reprint_records,
      pr.latest_reprint_record_at,
      coalesce(r.reprint_request_count, 0) as reprint_request_count,
      coalesce(r.reprint_pending_count, 0) as reprint_pending_count,
      coalesce(r.reprint_completed_count, 0) as reprint_completed_count,
      r.latest_reprint_status,
      coalesce(r.reprint_pending_count, 0) > 0 as reprint_pending,
      (
        false
      ) as is_reprint_record,
      case
        when coalesce(pr.received_admin_status, pr.processed_admin_status) = 'cancelled' then 'cancelled'
        when coalesce(r.reprint_pending_count, 0) > 0 then 'reprint_pending'
        when pr.external_order_id is not null and pr.processed_order_id is not null then 'processed'
        when pr.external_order_id is not null and pr.processed_order_id is null then 'received_only'
        when pr.external_order_id is null and pr.processed_order_id is not null then 'processed_without_received'
        else 'received_only'
      end as pipeline_status
    from pipeline_with_reprints pr
    left join reprint_summary r on r.order_id = pr.processed_order_id
  `);
  orderPipelineViewReady = true;
}

function mapPipelineRow(row) {
  const files = Array.isArray(row.print_files) ? row.print_files : [];
  const reprintRecords = Array.isArray(row.reprint_records) ? row.reprint_records : [];
  const displayOrderName = getCanonicalOrderIdentity(row) || '';
  return {
    orderName: row.order_number || row.processed_order_name || row.external_order_id || '',
    orderNumber: row.order_number || '',
    displayOrderName,
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
    orderType: normalizeOrderType(row.order_type),
    printFiles: files,
    sourceXmlPath: row.source_xml_path || '',
    sourceMonth: row.source_month || '',
    reprintRecordCount: Number(row.reprint_record_count) || reprintRecords.length,
    reprintRecords,
    latestReprintRecordAt: toIso(row.latest_reprint_record_at),
    reprintRequestCount: Number(row.reprint_request_count) || 0,
    reprintPendingCount: Number(row.reprint_pending_count) || 0,
    reprintCompletedCount: Number(row.reprint_completed_count) || 0,
    latestReprintStatus: row.latest_reprint_status || '',
    reprintPending: Boolean(row.reprint_pending),
    adminStatus: row.admin_status || '',
    adminNote: row.admin_note || '',
    adminUpdatedAt: toIso(row.admin_updated_at),
    isReprintRecord: Boolean(row.is_reprint_record),
    pipelineStatus: row.pipeline_status || 'received_only',
  };
}

function mapPipelineListRow(row) {
  const displayOrderName = getCanonicalOrderIdentity(row) || '';
  return {
    orderName: row.order_number || row.processed_order_name || row.external_order_id || '',
    orderNumber: row.order_number || '',
    displayOrderName,
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
    orderType: normalizeOrderType(row.order_type),
    printFiles: [],
    printFileCount: Number(row.print_file_count) || 0,
    pageSizes: row.page_sizes || '',
    sourceMonth: row.source_month || '',
    reprintRecordCount: Number(row.reprint_record_count) || 0,
    reprintRecords: [],
    latestReprintRecordAt: toIso(row.latest_reprint_record_at),
    reprintRequestCount: Number(row.reprint_request_count) || 0,
    reprintPendingCount: Number(row.reprint_pending_count) || 0,
    reprintCompletedCount: Number(row.reprint_completed_count) || 0,
    latestReprintStatus: row.latest_reprint_status || '',
    reprintPending: Boolean(row.reprint_pending),
    adminStatus: row.admin_status || '',
    adminNote: row.admin_note || '',
    adminUpdatedAt: toIso(row.admin_updated_at),
    isReprintRecord: Boolean(row.is_reprint_record),
    pipelineStatus: row.pipeline_status || 'received_only',
    hasDetail: false,
  };
}

function dedupeDefaultPipelineRows(rows) {
  const seen = new Set();
  const deduped = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    const identity = getCanonicalOrderIdentity(row);
    if (!identity) {
      deduped.push(row);
      continue;
    }
    const key = identity.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(row);
  }
  return deduped;
}

function isIsoDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''));
}

function addDateRangeFilter(where, params, options) {
  const preset = cleanString(options.datePreset || options.date_preset) || 'this_month';
  const from = cleanString(options.from);
  const to = cleanString(options.to);
  const dateExpr = isDefaultOrderPipelineScope(options) ? pipelineIncomingDateExpr() : pipelineDateExpr();

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

function addStatusFilter(where, value) {
  const status = cleanString(value) || 'all';
  if (status === 'all') return;
  if (status === 'needs_attention') {
    where.push(`(
      pipeline_status = 'received_only'
      or coalesce(reprint_pending_count, 0) > 0
    )`);
    return;
  }
  if (status === 'received_only' || status === 'unprocessed') {
    where.push(`pipeline_status = 'received_only'`);
    return;
  }
  if (status === 'processed') {
    where.push(`processed_order_id is not null`);
    return;
  }
  if (status === 'reprint_pending') {
    where.push(`coalesce(reprint_pending_count, 0) > 0`);
    return;
  }
  if (status === 'no_api_match') {
    where.push(`pipeline_status = 'processed_without_received'`);
    return;
  }
  if (status === 'cancelled') {
    where.push(`pipeline_status = 'cancelled'`);
    return;
  }
  if (status === 'has_reprint') {
    where.push(`coalesce(reprint_request_count, 0) > 0`);
  }
}

function shouldUseAllTimeReprintScope(options = {}) {
  const status = cleanString(options.status);
  const reprint = cleanString(options.reprint);
  if (status !== 'reprint_pending' && reprint !== 'pending') return false;

  const preset = cleanString(options.datePreset || options.date_preset) || 'this_month';
  const hasExplicitDate = Boolean(
    cleanString(options.month)
    || cleanString(options.from)
    || cleanString(options.to)
    || (preset && preset !== 'this_month')
  );
  return !hasExplicitDate;
}

function buildOrderPipelineFilters(options = {}) {
  const month = cleanString(options.month);
  const search = cleanString(options.q || options.search);
  const normalizedSearch = normalizeSearchTerm(options.q || options.search);
  const params = [];
  const where = [];
  const meta = {
    datePreset: cleanString(options.datePreset || options.date_preset) || 'this_month',
    hasMonth: Boolean(month),
    hasSearch: Boolean(search),
    searchMode: search ? (isOrderLikeSearch(search) ? 'order_like_exact' : 'text_ilike') : 'none',
    status: cleanString(options.status) || 'all',
    reprint: cleanString(options.reprint) || 'all',
    allTimeReprintScope: shouldUseAllTimeReprintScope(options),
  };

  if (!meta.allTimeReprintScope) addDateRangeFilter(where, params, options);
  addStatusFilter(where, options.status);
  addReprintFilter(where, options.reprint);
  if (isDefaultOrderPipelineScope(options)) where.push(defaultPipelineWhereSql());

  if (month) {
    params.push(month);
    where.push(`(
      source_month = $${params.length}
      or to_char(coalesce(processed_at, received_at, api_seen_at), 'YYYY-MM') = $${params.length}
      or to_char(latest_reprint_record_at, 'YYYY-MM') = $${params.length}
    )`);
  }
  if (search && isOrderLikeSearch(search)) {
    const candidates = orderSearchCandidates(search);
    params.push(candidates.exact);
    params.push(candidates.normalized);
    where.push(`(
      lower(coalesce(order_number, '')) = any($${params.length - 1}::text[])
      or lower(coalesce(processed_order_name, '')) = any($${params.length - 1}::text[])
      or lower(coalesce(external_order_id, '')) = any($${params.length - 1}::text[])
      or lower(coalesce(customer_order_id, '')) = any($${params.length - 1}::text[])
      or lower(regexp_replace(coalesce(xml_file_name, ''), '\\.xml$', '', 'i')) = any($${params.length - 1}::text[])
      or regexp_replace(lower(coalesce(order_number, '')), '[[:space:]_-]+', '', 'g') = any($${params.length}::text[])
      or regexp_replace(lower(coalesce(processed_order_name, '')), '[[:space:]_-]+', '', 'g') = any($${params.length}::text[])
      or regexp_replace(lower(coalesce(external_order_id, '')), '[[:space:]_-]+', '', 'g') = any($${params.length}::text[])
      or regexp_replace(lower(coalesce(customer_order_id, '')), '[[:space:]_-]+', '', 'g') = any($${params.length}::text[])
      or regexp_replace(lower(regexp_replace(coalesce(xml_file_name, ''), '\\.xml$', '', 'i')), '[[:space:]_-]+', '', 'g') = any($${params.length}::text[])
    )`);
  } else if (search) {
    params.push(`%${search}%`);
    params.push(`%${normalizedSearch}%`);
    where.push(`(
      coalesce(order_number, '') ilike $${params.length - 1}
      or coalesce(processed_order_name, '') ilike $${params.length - 1}
      or coalesce(external_order_id, '') ilike $${params.length - 1}
      or coalesce(customer_order_id, '') ilike $${params.length - 1}
      or coalesce(xml_file_name, '') ilike $${params.length - 1}
      or coalesce(source_xml_path, '') ilike $${params.length - 1}
      or regexp_replace(lower(coalesce(order_number, '')), '[[:space:]_-]+', '', 'g') ilike $${params.length}
      or regexp_replace(lower(coalesce(processed_order_name, '')), '[[:space:]_-]+', '', 'g') ilike $${params.length}
      or regexp_replace(lower(coalesce(external_order_id, '')), '[[:space:]_-]+', '', 'g') ilike $${params.length}
      or regexp_replace(lower(coalesce(customer_order_id, '')), '[[:space:]_-]+', '', 'g') ilike $${params.length}
      or regexp_replace(lower(coalesce(xml_file_name, '')), '[[:space:]_-]+', '', 'g') ilike $${params.length}
      or regexp_replace(lower(coalesce(source_xml_path, '')), '[[:space:]_-]+', '', 'g') ilike $${params.length}
    )`);
  }

  meta.whereCount = where.length;
  meta.paramCount = params.length;
  return { params, where, meta };
}

function mapPipelineStats(row) {
  return {
    total: Number(row && row.total) || 0,
    needsAttention: Number(row && row.needs_attention) || 0,
    unprocessed: Number(row && row.unprocessed) || 0,
    noApiMatch: Number(row && row.no_api_match) || 0,
    reprintBacklog: Number(row && row.reprint_backlog) || 0,
    processed: Number(row && row.processed) || 0,
    hasReprint: Number(row && row.has_reprint) || 0,
  };
}

async function queryPipelineStats(client, filters) {
  await ensureOrderPipelineView(client);
  const whereSql = filters.where.length ? `where ${filters.where.join(' and ')}` : '';
  const result = await client.query(
    `
      select
        count(*)::int as total,
        count(*) filter (
          where pipeline_status <> 'cancelled'
            and (
              pipeline_status = 'received_only'
              or coalesce(reprint_pending_count, 0) > 0
            )
        )::int as needs_attention,
        count(*) filter (where pipeline_status = 'received_only')::int as unprocessed,
        count(*) filter (where pipeline_status = 'processed_without_received')::int as no_api_match,
        count(*) filter (where pipeline_status <> 'cancelled' and coalesce(reprint_pending_count, 0) > 0)::int as reprint_backlog,
        count(*) filter (where pipeline_status <> 'cancelled' and processed_order_id is not null)::int as processed,
        count(*) filter (
          where pipeline_status <> 'cancelled'
            and (
              coalesce(reprint_request_count, 0) > 0
              or coalesce(reprint_record_count, 0) > 0
            )
        )::int as has_reprint
      from v_print_order_pipeline
      ${whereSql}
    `,
    filters.params
  );
  return mapPipelineStats(result.rows[0]);
}

async function queryFastPipelineStats(client, filters) {
  await ensureOrderPipelineBaseTables(client);
  const whereSql = filters.where.length ? `where ${filters.where.join(' and ')}` : '';
  const result = await client.query(
    `
      ${buildFastPipelineBaseCte()}
      select
        count(*)::int as total,
        count(*) filter (
          where pipeline_status <> 'cancelled'
            and (
              pipeline_status = 'received_only'
              or coalesce(reprint_pending_count, 0) > 0
            )
        )::int as needs_attention,
        count(*) filter (where pipeline_status = 'received_only')::int as unprocessed,
        count(*) filter (where pipeline_status = 'processed_without_received')::int as no_api_match,
        count(*) filter (where pipeline_status <> 'cancelled' and coalesce(reprint_pending_count, 0) > 0)::int as reprint_backlog,
        count(*) filter (where pipeline_status <> 'cancelled' and processed_order_id is not null)::int as processed,
        count(*) filter (where pipeline_status <> 'cancelled' and coalesce(reprint_request_count, 0) > 0)::int as has_reprint
      from pipeline_base
      ${whereSql}
    `,
    filters.params
  );
  return mapPipelineStats(result.rows[0]);
}

async function queryOperationalGlobalStats(client) {
  await ensureOrderPipelineBaseTables(client);
  const filters = buildOrderPipelineFilters({ datePreset: 'this_month' });
  const whereSql = filters.where.length ? `where ${filters.where.join(' and ')}` : '';
  const result = await client.query(
    `
      ${buildFastPipelineBaseCte()},
      current_scope as (
        select
          count(*)::int as total,
          count(*) filter (
            where pipeline_status <> 'cancelled'
              and (
                pipeline_status = 'received_only'
                or coalesce(reprint_pending_count, 0) > 0
              )
          )::int as needs_attention,
          count(*) filter (where pipeline_status = 'received_only')::int as unprocessed,
          count(*) filter (where pipeline_status = 'processed_without_received')::int as no_api_match,
          count(*) filter (where pipeline_status <> 'cancelled' and processed_order_id is not null)::int as processed,
          count(*) filter (where pipeline_status <> 'cancelled' and coalesce(reprint_request_count, 0) > 0)::int as has_reprint
        from pipeline_base
        ${whereSql}
      ),
      reprint_backlog as (
        select count(distinct r.order_id)::int as reprint_backlog
        from processed_order_reprint_requests r
        join processed_print_orders p on p.id = r.order_id
        where r.status = 'pending'
          and coalesce(p.ignored, false) = false
          and coalesce(p.admin_status, '') <> 'cancelled'
      )
      select current_scope.*, reprint_backlog.reprint_backlog
      from current_scope
      cross join reprint_backlog
    `,
    filters.params
  );
  return mapPipelineStats(result.rows[0]);
}

async function getOrderPipelineStats(client, options = {}) {
  const generatedAt = new Date().toISOString();
  const includeGlobal = options.includeGlobal !== false;
  const includeScope = Boolean(options.includeScope);
  const timings = options.timings || null;
  const stats = { generatedAt };
  const scopeNeedsFullView = includeScope && requiresFullReprintView(options);

  if (scopeNeedsFullView) await ensureOrderPipelineView(client);

  if (includeGlobal) {
    const now = Date.now();
    if (globalStatsCache && now < globalStatsCache.expiresAt) {
      stats.global = globalStatsCache.value;
      stats.globalCacheHit = true;
      if (timings) {
        timings.globalStatsMs = 0;
        timings.globalStatsCacheHit = true;
        timings.globalStatsPath = 'cache';
      }
    } else {
      const started = Date.now();
      stats.global = await queryOperationalGlobalStats(client);
      const duration = Date.now() - started;
      globalStatsCache = {
        value: stats.global,
        generatedAt,
        expiresAt: Date.now() + GLOBAL_STATS_TTL_MS,
      };
      stats.globalCacheHit = false;
      if (timings) {
        timings.globalStatsMs = duration;
        timings.globalStatsCacheHit = false;
        timings.globalStatsPath = 'fast_base';
      }
    }
  }

  if (includeScope) {
    const started = Date.now();
    const filters = buildOrderPipelineFilters(options);
    const useFullView = scopeNeedsFullView;
    stats.scope = useFullView
      ? await queryPipelineStats(client, filters)
      : await queryFastPipelineStats(client, filters);
    if (timings) timings.scopeStatsMs = Date.now() - started;
    if (timings) {
      timings.scopeStatsPath = useFullView ? 'full_view' : 'fast_base';
      timings.scopeStatsFilterMeta = filters.meta;
    }
  }

  return stats;
}

async function listOrderPipelineFullView(client, options = {}) {
  const limit = clampLimit(options.limit);
  const offset = clampOffset(options.offset);
  const filters = buildOrderPipelineFilters(options);
  const params = filters.params.slice();
  const where = filters.where;

  params.push(limit + 1);
  const limitParam = params.length;
  params.push(offset);
  const offsetParam = params.length;

  const started = Date.now();
  const result = await client.query(
    `
      select
        order_number,
        external_order_id,
        customer_order_id,
        received_at,
        api_seen_at,
        processed_order_id,
        processed_order_name,
        xml_file_name,
        processed_at,
        queued_date_time,
        workflow_name,
        order_type,
        source_month,
        admin_status,
        admin_note,
        admin_updated_at,
        reprint_record_count,
        latest_reprint_record_at,
        reprint_request_count,
        reprint_pending_count,
        reprint_completed_count,
        latest_reprint_status,
        reprint_pending,
        is_reprint_record,
        pipeline_status,
        jsonb_array_length(coalesce(print_files, '[]'::jsonb)) as print_file_count,
        (
          select string_agg(distinct nullif(file_item->>'pageSize', ''), ', ')
          from jsonb_array_elements(coalesce(print_files, '[]'::jsonb)) file_item
        ) as page_sizes
      from v_print_order_pipeline
      ${where.length ? `where ${where.join(' and ')}` : ''}
      order by ${pipelineSortExpr(options)}
      limit $${limitParam}
      offset $${offsetParam}
    `,
    params
  );
  if (options.timings) options.timings.rowsMs = Date.now() - started;
  if (options.timings) {
    options.timings.rowsPath = 'full_view';
    options.timings.rowsFilterMeta = filters.meta;
    options.timings.fullViewReason = options.fullViewReason || 'explicit_deep_scan';
  }
  console.warn('order-pipeline full-view slow path', {
    reason: options.fullViewReason || 'explicit_deep_scan',
    filters: filters.meta,
    requestUrl: options.requestUrl || '',
    elapsedMs: options.timings ? options.timings.rowsMs : Date.now() - started,
  });
  const sourceRows = isDefaultOrderPipelineScope(options)
    ? dedupeDefaultPipelineRows(result.rows)
    : result.rows;
  const rows = sourceRows.slice(0, limit).map(mapPipelineListRow);
  return {
    rows,
    limit,
    offset,
    hasMore: sourceRows.length > limit || result.rows.length > limit,
    nextOffset: offset + rows.length,
  };
}

async function listOrderPipelineFast(client, options = {}) {
  await ensureOrderPipelineBaseTables(client);
  const limit = clampLimit(options.limit);
  const offset = clampOffset(options.offset);
  const filters = buildOrderPipelineFilters(options);
  const params = filters.params.slice();
  const where = filters.where;

  params.push(limit + 1);
  const limitParam = params.length;
  params.push(offset);
  const offsetParam = params.length;

  const started = Date.now();
  const result = await client.query(
    `
      ${buildFastPipelineBaseCte()},
      filtered_pipeline as (
        select *
        from pipeline_base
        ${where.length ? `where ${where.join(' and ')}` : ''}
      ),
      page_base as (
        select *
        from filtered_pipeline
        order by ${pipelineSortExpr(options)}
        limit $${limitParam}
        offset $${offsetParam}
      ),
      processed_reprints as (
        select
          p.id,
          p.order_name,
          p.xml_file_name,
          p.status,
          p.queued_date_time,
          p.source_xml_path,
          p.print_files,
          ${reprintParentMatchKeySql('p')} as parent_match_key
        from processed_print_orders p
        where coalesce(p.ignored, false) = false
          and upper(coalesce(p.order_type, 'S')) = 'R'
      ),
      page_rows as (
        select
          pb.*,
          coalesce(rr.reprint_record_count, 0) as fast_reprint_record_count,
          rr.latest_reprint_record_at as fast_latest_reprint_record_at
        from page_base pb
        left join lateral (
          select
            count(*)::int as reprint_record_count,
            max(rp.queued_date_time) as latest_reprint_record_at
          from processed_reprints rp
          where rp.parent_match_key = any(array_remove(array[
            ${parentMatchKeyExpr('pb', 'order_number')},
            ${parentMatchKeyExpr('pb', 'processed_order_name')},
            ${parentMatchKeyExpr('pb', 'external_order_id')},
            ${parentMatchKeyExpr('pb', 'customer_order_id')}
          ], ''))
        ) rr on true
      )
      select
        order_number,
        external_order_id,
        customer_order_id,
        received_at,
        api_seen_at,
        processed_order_id,
        processed_order_name,
        xml_file_name,
        processed_at,
        queued_date_time,
        workflow_name,
        order_type,
        source_month,
        admin_status,
        admin_note,
        admin_updated_at,
        fast_reprint_record_count as reprint_record_count,
        fast_latest_reprint_record_at as latest_reprint_record_at,
        reprint_request_count,
        reprint_pending_count,
        reprint_completed_count,
        latest_reprint_status,
        reprint_pending,
        is_reprint_record,
        pipeline_status,
        jsonb_array_length(coalesce(print_files, '[]'::jsonb)) as print_file_count,
        (
          select string_agg(distinct nullif(file_item->>'pageSize', ''), ', ')
          from jsonb_array_elements(coalesce(print_files, '[]'::jsonb)) file_item
        ) as page_sizes
      from page_rows
      order by ${pipelineSortExpr(options)}
    `,
    params
  );
  if (options.timings) {
    options.timings.rowsMs = Date.now() - started;
    options.timings.rowsPath = 'fast_base';
    options.timings.rowsFilterMeta = filters.meta;
  }
  const sourceRows = isDefaultOrderPipelineScope(options)
    ? dedupeDefaultPipelineRows(result.rows)
    : result.rows;
  const rows = sourceRows.slice(0, limit).map(mapPipelineListRow);
  return {
    rows,
    limit,
    offset,
    hasMore: sourceRows.length > limit || result.rows.length > limit,
    nextOffset: offset + rows.length,
  };
}

async function listOrderPipeline(client, options = {}) {
  if (requiresFullReprintView(options)) {
    await ensureOrderPipelineView(client);
    return listOrderPipelineFullView(client, {
      ...options,
      fullViewReason: options.fullViewReason || 'explicit_deep_scan',
    });
  }
  return listOrderPipelineFast(client, options);
}

async function getOrderPipelineDetail(client, options = {}) {
  await ensureOrderPipelineView(client);
  const id = Number(options.id || options.processedOrderId || 0);
  const orderNumber = cleanString(options.orderNumber || options.order_number);
  if (!id && !orderNumber) {
    const error = new Error('Missing order id or orderNumber');
    error.statusCode = 400;
    throw error;
  }

  const params = [];
  const where = [];
  if (id) {
    params.push(id);
    where.push(`processed_order_id = $${params.length}`);
  }
  if (orderNumber) {
    params.push(orderNumber);
    where.push(`order_number = $${params.length}`);
  }

  const result = await client.query(
    `
      select *
      from v_print_order_pipeline
      where ${where.join(' or ')}
      order by coalesce(received_at, api_seen_at, processed_at, queued_date_time, latest_reprint_record_at) desc nulls last,
        nullif(regexp_replace(coalesce(order_number, ''), '[^0-9]+', '', 'g'), '')::bigint desc nulls last,
        order_number desc
      limit 1
    `,
    params
  );
  return result.rows[0] ? mapPipelineRow(result.rows[0]) : null;
}

async function listPipelineMonths(client) {
  await ensureOrderPipelineBaseTables(client);
  const result = await client.query(`
    with months as (
      select source_month as month
      from processed_print_orders
      where source_month is not null
        and source_month <> ''
        and coalesce(ignored, false) = false
      union all
      select to_char(coalesce(queued_date_time, order_date_time, imported_at), 'YYYY-MM') as month
      from processed_print_orders
      where source_month is null
        and coalesce(queued_date_time, order_date_time, imported_at) is not null
        and coalesce(ignored, false) = false
      union all
      select to_char(coalesce(received_at, api_seen_at), 'YYYY-MM') as month
      from print_orders_received
      where coalesce(received_at, api_seen_at) is not null
        and coalesce(ignored, false) = false
    )
    select month
    from months
    where month is not null and month <> ''
    group by month
    order by month desc
    limit 36
  `);
  return result.rows.map((row) => row.month).filter(Boolean);
}

module.exports = {
  getOrderPipelineDetail,
  getOrderPipelineStats,
  getCanonicalOrderIdentity,
  ensureOrderPipelineView,
  listOrderPipeline,
  listPipelineMonths,
  normalizeOrderIdentityCandidate,
};
