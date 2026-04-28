'use strict';

let processedOrdersSchemaReady = false;

function cleanString(value) {
  if (value == null) return null;
  const trimmed = String(value).trim();
  return trimmed || null;
}

function toIsoOrNull(value) {
  const cleaned = cleanString(value);
  if (!cleaned) return null;
  const normalized = cleaned.replace(/(\.\d{3})\d+([zZ]|[+-]\d{2}:?\d{2})$/, '$1$2');
  const date = new Date(normalized);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function normalizeBoolean(value) {
  const cleaned = String(value == null ? '' : value).trim().toLowerCase();
  if (!cleaned) return null;
  return cleaned === 'true' || cleaned === '1' || cleaned === 'yes';
}

function normalizePrintFiles(files) {
  return (Array.isArray(files) ? files : []).map((file) => ({
    printFilePath: cleanString(file.printFilePath),
    copies: Number.isFinite(Number(file.copies)) ? Number(file.copies) : null,
    pageSize: cleanString(file.pageSize),
  })).filter((file) => file.printFilePath || file.pageSize);
}

function makeOrderKey(order) {
  const guid = cleanString(order && order.guid);
  if (guid) return `guid:${guid}`;
  return [
    'fallback',
    cleanString(order && order.orderName) || '',
    cleanString(order && order.xmlFileName) || '',
    cleanString(order && order.sourceXmlHash) || '',
  ].join('|');
}

async function ensureProcessedPrintOrderTables(client) {
  if (processedOrdersSchemaReady) return;

  await client.query(`
    create table if not exists processed_print_orders (
      id bigserial primary key,
      order_key text not null unique,
      order_name text not null,
      xml_file_name text null,
      guid text null,
      status text null,
      order_date_time timestamptz null,
      queued_date_time timestamptz null,
      printer_name text null,
      run_workflow boolean null,
      workflow_name text null,
      order_type text null,
      print_files jsonb not null default '[]'::jsonb,
      source_xml_path text not null,
      source_xml_hash text not null,
      source_month text null,
      imported_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )
  `);
  await client.query(`create unique index if not exists processed_print_orders_guid_idx on processed_print_orders (guid) where guid is not null`);
  await client.query(`create index if not exists processed_print_orders_queued_idx on processed_print_orders (queued_date_time desc nulls last, id desc)`);
  await client.query(`create index if not exists processed_print_orders_source_month_idx on processed_print_orders (source_month)`);

  await client.query(`
    create table if not exists processed_order_reprint_requests (
      id bigserial primary key,
      order_id bigint not null references processed_print_orders(id) on delete cascade,
      order_name text not null,
      print_file_path text null,
      requested_by text null,
      requested_at timestamptz not null default now(),
      workstation_id text null,
      status text not null default 'pending',
      note text null
    )
  `);
  await client.query(`create index if not exists processed_reprint_order_idx on processed_order_reprint_requests (order_id, requested_at desc)`);

  processedOrdersSchemaReady = true;
}

function mapProcessedOrderRow(row) {
  const files = Array.isArray(row.print_files) ? row.print_files : [];
  return {
    id: Number(row.id),
    orderName: row.order_name,
    xmlFileName: row.xml_file_name,
    guid: row.guid,
    status: row.status,
    orderDateTime: row.order_date_time instanceof Date ? row.order_date_time.toISOString() : String(row.order_date_time || ''),
    queuedDateTime: row.queued_date_time instanceof Date ? row.queued_date_time.toISOString() : String(row.queued_date_time || ''),
    printerName: row.printer_name,
    runWorkflow: row.run_workflow,
    workflowName: row.workflow_name,
    orderType: row.order_type,
    printFiles: files,
    sourceXmlPath: row.source_xml_path,
    sourceXmlHash: row.source_xml_hash,
    sourceMonth: row.source_month,
    importedAt: row.imported_at instanceof Date ? row.imported_at.toISOString() : String(row.imported_at || ''),
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at || ''),
  };
}

async function upsertProcessedPrintOrder(client, input) {
  await ensureProcessedPrintOrderTables(client);
  const orderName = cleanString(input && input.orderName);
  const sourceXmlPath = cleanString(input && input.sourceXmlPath);
  const sourceXmlHash = cleanString(input && input.sourceXmlHash);
  if (!orderName || !sourceXmlPath || !sourceXmlHash) {
    throw new Error('Processed order requires orderName, sourceXmlPath, and sourceXmlHash');
  }

  const order = {
    orderName,
    xmlFileName: cleanString(input.xmlFileName),
    guid: cleanString(input.guid),
    status: cleanString(input.status),
    orderDateTime: toIsoOrNull(input.orderDateTime),
    queuedDateTime: toIsoOrNull(input.queuedDateTime),
    printerName: cleanString(input.printerName),
    runWorkflow: normalizeBoolean(input.runWorkflow),
    workflowName: cleanString(input.workflowName),
    orderType: cleanString(input.orderType),
    printFiles: normalizePrintFiles(input.printFiles),
    sourceXmlPath,
    sourceXmlHash,
    sourceMonth: cleanString(input.sourceMonth),
  };
  const orderKey = makeOrderKey(order);

  const existing = await client.query(
    `select source_xml_hash from processed_print_orders where order_key = $1 limit 1`,
    [orderKey]
  );
  const wasUnchanged = existing.rows[0] && existing.rows[0].source_xml_hash === sourceXmlHash;

  const result = await client.query(
    `
      insert into processed_print_orders (
        order_key, order_name, xml_file_name, guid, status, order_date_time, queued_date_time,
        printer_name, run_workflow, workflow_name, order_type, print_files,
        source_xml_path, source_xml_hash, source_month, imported_at, updated_at
      )
      values (
        $1, $2, $3, $4, $5, $6::timestamptz, $7::timestamptz,
        $8, $9, $10, $11, $12::jsonb,
        $13, $14, $15, now(), now()
      )
      on conflict (order_key) do update
      set
        order_name = excluded.order_name,
        xml_file_name = excluded.xml_file_name,
        guid = excluded.guid,
        status = excluded.status,
        order_date_time = excluded.order_date_time,
        queued_date_time = excluded.queued_date_time,
        printer_name = excluded.printer_name,
        run_workflow = excluded.run_workflow,
        workflow_name = excluded.workflow_name,
        order_type = excluded.order_type,
        print_files = excluded.print_files,
        source_xml_path = excluded.source_xml_path,
        source_xml_hash = excluded.source_xml_hash,
        source_month = excluded.source_month,
        updated_at = case
          when processed_print_orders.source_xml_hash is distinct from excluded.source_xml_hash then now()
          else processed_print_orders.updated_at
        end
      returning (xmax = 0) as inserted, id
    `,
    [
      orderKey,
      order.orderName,
      order.xmlFileName,
      order.guid,
      order.status,
      order.orderDateTime,
      order.queuedDateTime,
      order.printerName,
      order.runWorkflow,
      order.workflowName,
      order.orderType,
      JSON.stringify(order.printFiles),
      order.sourceXmlPath,
      order.sourceXmlHash,
      order.sourceMonth,
    ]
  );

  const inserted = Boolean(result.rows[0] && result.rows[0].inserted);
  return {
    id: result.rows[0] ? Number(result.rows[0].id) : null,
    inserted,
    updated: !inserted && !wasUnchanged,
    unchanged: !inserted && Boolean(wasUnchanged),
  };
}

async function listProcessedPrintOrders(client, options = {}) {
  await ensureProcessedPrintOrderTables(client);
  const limit = Math.min(500, Math.max(1, Number(options.limit) || 500));
  const month = cleanString(options.month);
  const search = cleanString(options.search);
  const params = [limit];
  const where = [];

  if (month) {
    params.push(month);
    where.push(`source_month = $${params.length}`);
  }
  if (search) {
    params.push(`%${search}%`);
    where.push(`(
      order_name ilike $${params.length}
      or coalesce(xml_file_name, '') ilike $${params.length}
      or coalesce(workflow_name, '') ilike $${params.length}
      or print_files::text ilike $${params.length}
    )`);
  }

  const result = await client.query(
    `
      select *
      from processed_print_orders
      ${where.length ? `where ${where.join(' and ')}` : ''}
      order by queued_date_time desc nulls last, updated_at desc, id desc
      limit $1
    `,
    params
  );
  return result.rows.map(mapProcessedOrderRow);
}

async function listProcessedOrderMonths(client) {
  await ensureProcessedPrintOrderTables(client);
  const result = await client.query(`
    select source_month
    from processed_print_orders
    where source_month is not null
    group by source_month
    order by source_month desc
    limit 36
  `);
  return result.rows.map((row) => row.source_month).filter(Boolean);
}

async function createReprintRequest(client, input) {
  await ensureProcessedPrintOrderTables(client);
  const orderId = Number(input && input.orderId);
  if (!Number.isInteger(orderId) || orderId <= 0) throw new Error('Missing order id');

  const orderResult = await client.query(
    `select id, order_name, print_files from processed_print_orders where id = $1 limit 1`,
    [orderId]
  );
  const order = orderResult.rows[0];
  if (!order) {
    const error = new Error('Processed order not found');
    error.statusCode = 404;
    throw error;
  }

  const printFilePath = cleanString(input.printFilePath) ||
    (((Array.isArray(order.print_files) ? order.print_files : [])[0] || {}).printFilePath || null);

  const result = await client.query(
    `
      insert into processed_order_reprint_requests (
        order_id, order_name, print_file_path, requested_by, requested_at, workstation_id, status, note
      )
      values ($1, $2, $3, $4, now(), $5, 'pending', $6)
      returning id, order_id, order_name, print_file_path, requested_by, requested_at, workstation_id, status, note
    `,
    [
      order.id,
      order.order_name,
      printFilePath,
      cleanString(input.requestedBy),
      cleanString(input.workstationId),
      cleanString(input.note),
    ]
  );

  const row = result.rows[0];
  return {
    id: Number(row.id),
    orderId: Number(row.order_id),
    orderName: row.order_name,
    printFilePath: row.print_file_path,
    requestedBy: row.requested_by,
    requestedAt: row.requested_at instanceof Date ? row.requested_at.toISOString() : String(row.requested_at || ''),
    workstationId: row.workstation_id,
    status: row.status,
    note: row.note,
  };
}

module.exports = {
  createReprintRequest,
  ensureProcessedPrintOrderTables,
  listProcessedOrderMonths,
  listProcessedPrintOrders,
  upsertProcessedPrintOrder,
};
