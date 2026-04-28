#!/usr/bin/env node
'use strict';

const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');
const { withClient } = require('../netlify/functions/_lib/db');
const { upsertProcessedPrintOrder, ensureProcessedPrintOrderTables } = require('../netlify/functions/_lib/processed-print-orders');

function parseArgs(argv) {
  const args = {};
  for (const token of argv) {
    if (!token.startsWith('--')) continue;
    const eq = token.indexOf('=');
    if (eq === -1) args[token.slice(2)] = true;
    else args[token.slice(2, eq)] = token.slice(eq + 1);
  }
  return args;
}

function cleanString(value) {
  if (value == null) return '';
  return String(value).trim();
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function decodeXml(value) {
  return cleanString(value)
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function getTag(xml, tagName) {
  const match = String(xml || '').match(new RegExp(`<${tagName}\\b[^>]*>([\\s\\S]*?)<\\/${tagName}>`, 'i'));
  return match ? decodeXml(match[1]) : '';
}

function getBlocks(xml, tagName) {
  const blocks = [];
  const re = new RegExp(`<${tagName}\\b[^>]*>([\\s\\S]*?)<\\/${tagName}>`, 'gi');
  let match;
  while ((match = re.exec(String(xml || ''))) !== null) {
    blocks.push(match[1]);
  }
  return blocks;
}

function getVariable(block, name) {
  for (const variable of getBlocks(block, 'Variable')) {
    if (getTag(variable, 'Name').toLowerCase() === String(name || '').toLowerCase()) {
      return getTag(variable, 'Value');
    }
  }
  return '';
}

function parseProcessedPrintOrderXml(xml, sourceXmlPath, sourceMonth) {
  const printFiles = getBlocks(xml, 'PrintFile').map((block) => ({
    printFilePath: getTag(block, 'FileName'),
    copies: Number(getTag(block, 'Copies')) || null,
    pageSize: getVariable(block, 'PageSize'),
  }));

  return {
    orderName: getTag(xml, 'Name'),
    xmlFileName: getTag(xml, 'XmlFileName') || path.basename(sourceXmlPath),
    guid: getTag(xml, 'Guid'),
    status: getTag(xml, 'Status'),
    orderDateTime: getTag(xml, 'OrderDateTime'),
    queuedDateTime: getTag(xml, 'QueuedDateTime'),
    printerName: getTag(xml, 'PrinterName'),
    runWorkflow: getTag(xml, 'RunWorkflow'),
    workflowName: getTag(xml, 'WorkflowName'),
    orderType: getTag(xml, 'OrderType'),
    printFiles,
    sourceXmlPath,
    sourceXmlHash: sha256(xml),
    sourceMonth,
  };
}

function formatMonth(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function toPositiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

async function listMonthFolders(root, options) {
  if (options.month) return [options.month];

  if (options.full) {
    const entries = await fs.readdir(root, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory() && /^\d{4}-\d{2}$/.test(entry.name))
      .map((entry) => entry.name)
      .sort();
  }

  const months = new Set();
  const today = new Date();
  for (let offset = 0; offset < options.days; offset += 1) {
    const date = new Date(today);
    date.setDate(today.getDate() - offset);
    months.add(formatMonth(date));
  }
  return Array.from(months).sort();
}

async function listXmlFiles(folderPath) {
  let entries;
  try {
    entries = await fs.readdir(folderPath, { withFileTypes: true });
  } catch (error) {
    if (error && error.code === 'ENOENT') return [];
    if (error && (error.code === 'EACCES' || error.code === 'EPERM')) {
      throw new Error(`Cannot access processed XML folder: ${folderPath}. Check NAS permissions and the scheduled-task Windows user.`);
    }
    throw error;
  }

  return entries
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.xml'))
    .map((entry) => path.join(folderPath, entry.name))
    .sort((a, b) => a.localeCompare(b));
}

async function syncProcessedPrintOrders(client, options) {
  await ensureProcessedPrintOrderTables(client);
  const stats = {
    monthsScanned: 0,
    scannedXmlFiles: 0,
    insertedOrders: 0,
    updatedOrders: 0,
    skippedUnchanged: 0,
    errors: 0,
  };

  if (options.file) {
    stats.monthsScanned = 1;
    stats.scannedXmlFiles = 1;
    try {
      const xml = await fs.readFile(options.file, 'utf8');
      const folderName = path.basename(path.dirname(options.file));
      const sourceMonth = /^\d{4}-\d{2}$/.test(folderName) ? folderName : '';
      const order = parseProcessedPrintOrderXml(xml, options.file, sourceMonth);
      if (!order.orderName) throw new Error('Missing <Name>');
      const result = await upsertProcessedPrintOrder(client, order);
      if (result.inserted) stats.insertedOrders += 1;
      else if (result.updated) stats.updatedOrders += 1;
      else stats.skippedUnchanged += 1;
    } catch (error) {
      stats.errors += 1;
      console.warn(`[processed-orders] ${options.file}: ${error.message}`);
    }
    return stats;
  }

  const months = await listMonthFolders(options.root, options);
  for (const month of months) {
    const folderPath = path.join(options.root, month);
    stats.monthsScanned += 1;
    const files = await listXmlFiles(folderPath);
    for (const filePath of files) {
      stats.scannedXmlFiles += 1;
      try {
        const xml = await fs.readFile(filePath, 'utf8');
        const order = parseProcessedPrintOrderXml(xml, filePath, month);
        if (!order.orderName) throw new Error('Missing <Name>');
        const result = await upsertProcessedPrintOrder(client, order);
        if (result.inserted) stats.insertedOrders += 1;
        else if (result.updated) stats.updatedOrders += 1;
        else stats.skippedUnchanged += 1;
      } catch (error) {
        stats.errors += 1;
        console.warn(`[processed-orders] ${filePath}: ${error.message}`);
      }
    }
  }

  return stats;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const root = cleanString(args.root || process.env.PROCESSED_PRINT_ORDERS_ROOT || process.env.ONYX_PROCESSED_XML_ROOT);
  const file = cleanString(args.file);
  if (!root && !file) {
    throw new Error('PROCESSED_PRINT_ORDERS_ROOT is not configured');
  }

  const options = {
    root: (root || path.dirname(file)).replace(/[\\/]+$/, ''),
    month: cleanString(args.month),
    file,
    days: toPositiveInteger(args.days || process.env.PROCESSED_PRINT_ORDERS_DAYS, 2),
    full: Boolean(args.full),
  };

  console.log(`[processed-orders] sync start root=${options.root} scope=${options.file || (options.full ? 'full' : options.month || `${options.days}d`)}`);
  const result = await withClient((client) => syncProcessedPrintOrders(client, options));
  console.log('[processed-orders] sync success');
  console.log(`[processed-orders] months=${result.monthsScanned} scannedXmlFiles=${result.scannedXmlFiles} insertedOrders=${result.insertedOrders} updatedOrders=${result.updatedOrders} skippedUnchanged=${result.skippedUnchanged} errors=${result.errors}`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error('[processed-orders] sync failed');
    console.error(error && error.stack ? error.stack : error);
    process.exit(1);
  });
}

module.exports = {
  parseProcessedPrintOrderXml,
  syncProcessedPrintOrders,
};
