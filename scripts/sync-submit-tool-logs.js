#!/usr/bin/env node
'use strict';

const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');
const { withClient } = require('../netlify/functions/_lib/db');
const { ensurePrintOrdersTable } = require('../netlify/functions/_lib/postpurchase-orders');

const SOURCE = 'submit_tool';
const WORKFLOW_STATUS = 'WorkflowRun';

function parseArgs(argv) {
  const args = {};
  for (const token of argv) {
    if (!token.startsWith('--')) continue;
    const eq = token.indexOf('=');
    if (eq === -1) {
      args[token.slice(2)] = true;
    } else {
      args[token.slice(2, eq)] = token.slice(eq + 1);
    }
  }
  return args;
}

function toPositiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function formatDateFolder(date) {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function getDateFolders(days, explicitDate) {
  if (explicitDate) return [explicitDate];
  const folders = [];
  const today = new Date();
  for (let offset = 0; offset < days; offset += 1) {
    const date = new Date(today);
    date.setDate(today.getDate() - offset);
    folders.push(formatDateFolder(date));
  }
  return folders;
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value || ''), 'utf8').digest('hex');
}

function parseKeyValues(value) {
  const attrs = {};
  for (const part of String(value || '').split(/\s+/)) {
    const clean = part.replace(/,+$/, '');
    const eq = clean.indexOf('=');
    if (eq <= 0) continue;
    attrs[clean.slice(0, eq)] = clean.slice(eq + 1);
  }
  return attrs;
}

function parseSubmitToolLine(rawLine) {
  const line = String(rawLine || '').trim();
  if (!line) return null;

  const match = line.match(/^(\d{4}-\d{2}-\d{2}),(\d{2})\.(\d{2})\.(\d{2})\.(\d{3}),([^,]+),(.+)$/);
  if (!match) return null;

  const [, date, hh, mm, ss, ms, moduleName, message] = match;
  const messageMatch = message.trim().match(/^(PrintJob|OpenPrintJob)\s+(\S+)(?:,\s*(.*))?$/);
  if (!messageMatch) return null;

  const [, eventType, orderIdentifier, attrsText] = messageMatch;
  const attrs = parseKeyValues(attrsText);
  const eventStatus = attrs.status || (attrs.runWF ? `runWF=${attrs.runWF}` : '');

  if (eventType === 'PrintJob' && eventStatus === 'Opened') {
    return { skipped: true, reason: 'opened-noise' };
  }
  if (eventType === 'OpenPrintJob' && attrs.print === 'False' && attrs.runWF === 'True') {
    return { skipped: true, reason: 'runwf-noise' };
  }
  if (eventType !== 'PrintJob' || eventStatus !== WORKFLOW_STATUS) return null;

  const eventAt = new Date(`${date}T${hh}:${mm}:${ss}.${ms}`);
  if (Number.isNaN(eventAt.getTime())) return null;
  const eventAtIso = eventAt.toISOString();
  const rawLineHash = sha256(line);
  // WorkflowRun is the durable marker that Submit Tool actually started
  // workflow execution; Opened and runWF=True are intermediate noise.
  const lifecycleDedupeKey = [SOURCE, orderIdentifier, WORKFLOW_STATUS, eventAtIso || rawLineHash].join('|');

  return {
    source: SOURCE,
    event_type: eventType,
    order_identifier: orderIdentifier,
    event_status: eventStatus,
    event_at: eventAtIso,
    module: moduleName.trim(),
    raw_line: line,
    raw_line_hash: rawLineHash,
    lifecycle_dedupe_key: lifecycleDedupeKey,
  };
}

async function ensureLifecycleEventsTable(client) {
  await ensurePrintOrdersTable(client);
  await client.query(`
    create table if not exists print_lifecycle_events (
      id bigserial primary key,
      source text not null,
      source_module text null,
      event_type text not null,
      order_identifier text not null,
      order_number text null,
      matched_external_order_id text null,
      event_status text null,
      event_at timestamptz not null,
      raw_line text not null,
      raw_line_hash text not null unique,
      created_at timestamptz not null default now()
    )
  `);
  await client.query(`alter table print_lifecycle_events add column if not exists source_module text null`);
  await client.query(`alter table print_lifecycle_events add column if not exists lifecycle_dedupe_key text null`);
  await client.query(`
    update print_lifecycle_events
    set lifecycle_dedupe_key = concat_ws('|', source, order_identifier, coalesce(event_status, ''), to_char(event_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
    where lifecycle_dedupe_key is null
  `);
  await client.query(`
    create index if not exists print_lifecycle_events_order_idx
      on print_lifecycle_events (source, order_identifier, event_at desc)
  `);
  await client.query(`
    create unique index if not exists print_lifecycle_events_dedupe_key_idx
      on print_lifecycle_events (lifecycle_dedupe_key)
      where lifecycle_dedupe_key is not null
  `);
}

function getMatchCandidates(identifier) {
  const id = String(identifier || '').trim();
  const candidates = new Set([id]);
  if (/^PS\d+$/i.test(id)) candidates.add(id.replace(/^PS/i, ''));
  if (/^\d+$/.test(id)) candidates.add(`PS${id}`);
  return Array.from(candidates).filter(Boolean);
}

async function findMatchingOrder(client, identifier) {
  const candidates = getMatchCandidates(identifier);
  const result = await client.query(
    `
      select id, external_order_id, order_number, customer_order_id
      from print_orders_received
      where external_order_id = any($1::text[])
        or order_number = any($1::text[])
        or customer_order_id = any($1::text[])
        or source_payload->>'document_id' = any($1::text[])
        or source_payload->>'documentId' = any($1::text[])
        or source_payload->>'ecommerce_id' = any($1::text[])
        or source_payload->>'ecommerceId' = any($1::text[])
        or source_payload->>'id' = any($1::text[])
      order by coalesce(received_at, api_seen_at) desc, id desc
      limit 1
    `,
    [candidates]
  );
  return result.rows[0] || null;
}

async function insertLifecycleEvent(client, event, matchedOrder) {
  const result = await client.query(
    `
      insert into print_lifecycle_events (
        source,
        source_module,
        event_type,
        order_identifier,
        order_number,
        matched_external_order_id,
        event_status,
        event_at,
        raw_line,
        raw_line_hash,
        lifecycle_dedupe_key
      )
      values ($1, $2, $3, $4, $5, $6, $7, $8::timestamptz, $9, $10, $11)
      on conflict (lifecycle_dedupe_key) where lifecycle_dedupe_key is not null do update
      set
        order_number = coalesce(print_lifecycle_events.order_number, excluded.order_number),
        matched_external_order_id = coalesce(print_lifecycle_events.matched_external_order_id, excluded.matched_external_order_id),
        raw_line = coalesce(print_lifecycle_events.raw_line, excluded.raw_line),
        raw_line_hash = coalesce(print_lifecycle_events.raw_line_hash, excluded.raw_line_hash)
      returning (xmax = 0) as inserted
    `,
    [
      event.source,
      event.module,
      event.event_type,
      event.order_identifier,
      matchedOrder ? matchedOrder.order_number : null,
      matchedOrder ? matchedOrder.external_order_id : null,
      event.event_status,
      event.event_at,
      event.raw_line,
      event.raw_line_hash,
      event.lifecycle_dedupe_key,
    ]
  );
  return Boolean(result.rows[0] && result.rows[0].inserted);
}

async function updateSubmitToolStatus(client, event, matchedOrder) {
  if (!matchedOrder || event.event_status !== WORKFLOW_STATUS) return false;

  const result = await client.query(
    `
      update print_orders_received
      set
        submit_tool_at = case
          when submit_tool_at is null or submit_tool_at > $2::timestamptz then $2::timestamptz
          else submit_tool_at
        end,
        submit_tool_processed_at = case
          when submit_tool_processed_at is null or submit_tool_processed_at > $2::timestamptz then $2::timestamptz
          else submit_tool_processed_at
        end,
        submit_tool_status = 'confirmed',
        updated_at = now()
      where external_order_id = $1
        and (
          submit_tool_at is null
          or submit_tool_processed_at is null
          or submit_tool_at > $2::timestamptz
          or submit_tool_processed_at > $2::timestamptz
          or submit_tool_status is distinct from 'confirmed'
        )
      returning external_order_id
    `,
    [matchedOrder.external_order_id, event.event_at]
  );

  return result.rowCount > 0;
}

async function listTxtFiles(folderPath) {
  let entries;
  try {
    entries = await fs.readdir(folderPath, { withFileTypes: true });
  } catch (error) {
    if (error && error.code === 'ENOENT') return [];
    throw error;
  }

  return entries
    .filter(entry => entry.isFile() && entry.name.toLowerCase().endsWith('.txt'))
    .map(entry => path.join(folderPath, entry.name));
}

async function readEventsFromFile(filePath, stats) {
  const text = await fs.readFile(filePath, 'utf8');
  const events = [];
  const lines = text.split(/\r?\n/);

  for (let index = 0; index < lines.length; index += 1) {
    const rawLine = lines[index];
    if (!rawLine.trim()) continue;
    stats.linesRead += 1;
    try {
      const event = parseSubmitToolLine(rawLine);
      if (event && event.skipped) {
        stats.noisyEventsSkipped += 1;
      } else if (event) {
        events.push(event);
        stats.linesParsed += 1;
      }
    } catch (error) {
      stats.parseErrors += 1;
      console.warn(`[submit-tool] parse error ${filePath}:${index + 1} ${error.message}`);
    }
  }

  return events;
}

async function syncSubmitToolLogs(client, options) {
  await ensureLifecycleEventsTable(client);

  const stats = {
    foldersScanned: 0,
    filesScanned: 0,
    linesRead: 0,
    linesParsed: 0,
    noisyEventsSkipped: 0,
    duplicateEventsSkipped: 0,
    parseErrors: 0,
    eventsInserted: 0,
    ordersUpdated: 0,
    unmatchedIdentifiers: new Set(),
  };

  const folders = getDateFolders(options.days, options.date);

  for (const folderName of folders) {
    const folderPath = path.join(options.root, folderName);
    const files = await listTxtFiles(folderPath);
    stats.foldersScanned += 1;

    for (const filePath of files) {
      stats.filesScanned += 1;
      const events = await readEventsFromFile(filePath, stats);

      for (const event of events) {
        const matchedOrder = await findMatchingOrder(client, event.order_identifier);
        const inserted = await insertLifecycleEvent(client, event, matchedOrder);
        if (inserted) stats.eventsInserted += 1;
        else stats.duplicateEventsSkipped += 1;

        const updated = await updateSubmitToolStatus(client, event, matchedOrder);
        if (updated) {
          stats.ordersUpdated += 1;
        } else if (!matchedOrder) {
          stats.unmatchedIdentifiers.add(event.order_identifier);
        }
      }
    }
  }

  return {
    ...stats,
    unmatchedIdentifiers: Array.from(stats.unmatchedIdentifiers).sort(),
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const root = String(process.env.SUBMIT_TOOL_LOG_ROOT || '').trim();
  if (!root) {
    throw new Error('SUBMIT_TOOL_LOG_ROOT is not configured');
  }

  const options = {
    root,
    days: toPositiveInteger(args.days || process.env.SUBMIT_TOOL_LOG_DAYS, 1),
    date: args.date ? String(args.date) : '',
  };

  console.log(`[submit-tool] sync start root=${options.root} days=${options.date || options.days}`);

  const result = await withClient(client => syncSubmitToolLogs(client, options));

  console.log('[submit-tool] sync success');
  console.log(`[submit-tool] folders=${result.foldersScanned} files=${result.filesScanned} lines=${result.linesRead} workflowEvents=${result.linesParsed} noisySkipped=${result.noisyEventsSkipped} duplicateSkipped=${result.duplicateEventsSkipped} parseErrors=${result.parseErrors}`);
  console.log(`[submit-tool] eventsInserted=${result.eventsInserted} ordersUpdated=${result.ordersUpdated} unmatched=${result.unmatchedIdentifiers.length}`);
  if (result.unmatchedIdentifiers.length) {
    console.log(`[submit-tool] unmatchedIdentifiers=${result.unmatchedIdentifiers.slice(0, 50).join(',')}`);
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error('[submit-tool] sync failed');
    console.error(error && error.stack ? error.stack : error);
    process.exit(1);
  });
}

module.exports = {
  parseSubmitToolLine,
  syncSubmitToolLogs,
};
