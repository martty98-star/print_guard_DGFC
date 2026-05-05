#!/usr/bin/env node
'use strict';

const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');
const { withClient } = require('../netlify/functions/_lib/db');
const {
  listKnownProcessedXmlHashes,
  upsertProcessedPrintOrder,
  ensureProcessedPrintOrderTables,
} = require('../netlify/functions/_lib/processed-print-orders');

const DEFAULT_OPERATION_TIMEOUT_MS = 60 * 1000;

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

function getElementAttribute(xml, tagName, attributeName) {
  const match = String(xml || '').match(new RegExp(`<${tagName}\\b([^>]*)>`, 'i'));
  if (!match) return '';
  const attrs = match[1] || '';
  const attrMatch = attrs.match(new RegExp(`\\b${attributeName}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s"'=<>]+))`, 'i'));
  if (!attrMatch) return '';
  return decodeXml(attrMatch[2] || attrMatch[3] || attrMatch[4] || '');
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

function detectLegacyReprint(orderName, xmlFileName, sourceXmlPath) {
  return /reprint/i.test(`${orderName || ''} ${xmlFileName || ''} ${sourceXmlPath || ''}`);
}

function normalizeOrderType(value, orderName, xmlFileName, sourceXmlPath) {
  const normalized = cleanString(value).toUpperCase();
  if (normalized === 'R') return 'R';
  if (normalized === 'N') return 'N';
  return detectLegacyReprint(orderName, xmlFileName, sourceXmlPath) ? 'R' : 'N';
}

function parseProcessedPrintOrderXml(xml, sourceXmlPath, sourceMonth) {
  const printFiles = getBlocks(xml, 'PrintFile').map((block) => ({
    printFilePath: getTag(block, 'FileName'),
    copies: Number(getTag(block, 'Copies')) || null,
    pageSize: getVariable(block, 'PageSize'),
  }));
  const orderName = getTag(xml, 'Name');
  const xmlFileName = getTag(xml, 'XmlFileName') || path.basename(sourceXmlPath);
  const orderType = getElementAttribute(xml, 'XmlPrintJob', 'OrderType')
    || getElementAttribute(xml, 'PrintJob', 'OrderType')
    || getTag(xml, 'OrderType');

  return {
    orderName,
    xmlFileName,
    guid: getTag(xml, 'Guid'),
    status: getTag(xml, 'Status'),
    orderDateTime: getTag(xml, 'OrderDateTime'),
    queuedDateTime: getTag(xml, 'QueuedDateTime'),
    printerName: getTag(xml, 'PrinterName'),
    runWorkflow: getTag(xml, 'RunWorkflow'),
    workflowName: getTag(xml, 'WorkflowName'),
    orderType: normalizeOrderType(orderType, orderName, xmlFileName, sourceXmlPath),
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

function getTimeoutMs(options) {
  return toPositiveInteger(options && options.timeoutMs, DEFAULT_OPERATION_TIMEOUT_MS);
}

function withTimeout(promise, label, timeoutMs) {
  let timer = null;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => {
        reject(new Error(`${label} timed out after ${timeoutMs}ms`));
      }, timeoutMs);
    }),
  ]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

async function checkRootExists(root, options) {
  console.log(`[processed-orders] checking root: ${root}`);
  try {
    await withTimeout(fs.access(root), `checking root ${root}`, getTimeoutMs(options));
    console.log('[processed-orders] root exists: true');
    return true;
  } catch (error) {
    console.log('[processed-orders] root exists: false');
    throw error;
  }
}

async function listMonthFolders(root, options) {
  console.log('[processed-orders] listing month folders');
  if (options.month) {
    console.log(`[processed-orders] selected folders: ${options.month}`);
    return [options.month];
  }

  if (options.full) {
    const entries = await withTimeout(
      fs.readdir(root, { withFileTypes: true }),
      `listing month folders in ${root}`,
      getTimeoutMs(options)
    );
    const folders = entries
      .filter((entry) => entry.isDirectory() && /^\d{4}-\d{2}$/.test(entry.name))
      .map((entry) => entry.name)
      .sort();
    console.log(`[processed-orders] selected folders: ${folders.join(',') || '(none)'}`);
    return folders;
  }

  const months = new Set();
  const today = new Date();
  for (let offset = 0; offset < options.days; offset += 1) {
    const date = new Date(today);
    date.setDate(today.getDate() - offset);
    months.add(formatMonth(date));
  }
  const folders = Array.from(months).sort();
  console.log(`[processed-orders] selected folders: ${folders.join(',') || '(none)'}`);
  return folders;
}

async function listXmlFiles(folderPath, options) {
  console.log(`[processed-orders] listing XML files: ${folderPath}`);
  let entries;
  try {
    entries = await withTimeout(
      fs.readdir(folderPath, { withFileTypes: true }),
      `listing XML files in ${folderPath}`,
      getTimeoutMs(options)
    );
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      console.log(`[processed-orders] XML files found: 0 (${folderPath} missing)`);
      return [];
    }
    if (error && (error.code === 'EACCES' || error.code === 'EPERM')) {
      throw new Error(`Cannot access processed XML folder: ${folderPath}. Check NAS permissions and the scheduled-task Windows user.`);
    }
    throw error;
  }

  const files = entries
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.xml'))
    .map((entry) => path.join(folderPath, entry.name))
    .sort((a, b) => a.localeCompare(b));
  console.log(`[processed-orders] XML files found: ${files.length}`);

  if (options.full || options.month || !options.days) {
    return files;
  }

  const cutoffMs = Date.now() - options.days * 24 * 60 * 60 * 1000;
  console.log(`[processed-orders] filtering XML files by modified time: last ${options.days} days`);
  const recentFiles = [];
  for (const filePath of files) {
    const stat = await withTimeout(
      fs.stat(filePath),
      `reading file metadata ${filePath}`,
      getTimeoutMs(options)
    );
    if (stat.mtimeMs >= cutoffMs) {
      recentFiles.push(filePath);
    }
  }
  console.log(`[processed-orders] XML files selected after days filter: ${recentFiles.length}`);
  return recentFiles;
}

async function listKnownHashesForFiles(client, files, options) {
  if (!files.length) return new Map();
  console.log(`[processed-orders] loading known XML hashes from DB: ${files.length} paths`);
  const known = await withTimeout(
    listKnownProcessedXmlHashes(client, files),
    `loading known XML hashes for ${files.length} paths`,
    getTimeoutMs(options)
  );
  console.log(`[processed-orders] known XML hashes loaded: ${known.size}`);
  return known;
}

async function syncProcessedPrintOrders(client, options) {
  console.log('[processed-orders] ensuring database schema');
  await ensureProcessedPrintOrderTables(client);
  console.log('[processed-orders] database schema ready');
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
      console.log(`[processed-orders] parsing XML 1/1: ${options.file}`);
      const xml = await withTimeout(
        fs.readFile(options.file, 'utf8'),
        `reading XML ${options.file}`,
        getTimeoutMs(options)
      );
      const sourceXmlHash = sha256(xml);
      const knownHashes = await listKnownHashesForFiles(client, [options.file], options);
      if (knownHashes.get(options.file) === sourceXmlHash) {
        console.log(`[processed-orders] unchanged XML skip: ${options.file}`);
        stats.skippedUnchanged += 1;
        return stats;
      }
      const folderName = path.basename(path.dirname(options.file));
      const sourceMonth = /^\d{4}-\d{2}$/.test(folderName) ? folderName : '';
      const order = parseProcessedPrintOrderXml(xml, options.file, sourceMonth);
      if (!order.orderName) throw new Error('Missing <Name>');
      console.log(`[processed-orders] DB upsert start: ${order.orderName} (${order.xmlFileName || path.basename(options.file)})`);
      const result = await withTimeout(
        upsertProcessedPrintOrder(client, order),
        `DB upsert ${options.file}`,
        getTimeoutMs(options)
      );
      console.log(`[processed-orders] DB upsert success: ${order.orderName}`);
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
    const files = await listXmlFiles(folderPath, options);
    const knownHashes = await listKnownHashesForFiles(client, files, options);
    for (let index = 0; index < files.length; index += 1) {
      const filePath = files[index];
      stats.scannedXmlFiles += 1;
      try {
        console.log(`[processed-orders] parsing XML ${index + 1}/${files.length}: ${filePath}`);
        const xml = await withTimeout(
          fs.readFile(filePath, 'utf8'),
          `reading XML ${filePath}`,
          getTimeoutMs(options)
        );
        const sourceXmlHash = sha256(xml);
        if (knownHashes.get(filePath) === sourceXmlHash) {
          console.log(`[processed-orders] unchanged XML skip ${index + 1}/${files.length}: ${filePath}`);
          stats.skippedUnchanged += 1;
          continue;
        }
        const order = parseProcessedPrintOrderXml(xml, filePath, month);
        if (!order.orderName) throw new Error('Missing <Name>');
        console.log(`[processed-orders] DB upsert start: ${order.orderName} (${order.xmlFileName || path.basename(filePath)})`);
        const result = await withTimeout(
          upsertProcessedPrintOrder(client, order),
          `DB upsert ${filePath}`,
          getTimeoutMs(options)
        );
        console.log(`[processed-orders] DB upsert success: ${order.orderName}`);
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
    timeoutMs: toPositiveInteger(args.timeoutMs || process.env.PROCESSED_PRINT_ORDERS_TIMEOUT_MS, DEFAULT_OPERATION_TIMEOUT_MS),
  };

  console.log(`[processed-orders] resolved root path: ${options.root}`);
  console.log(`[processed-orders] operation timeout: ${options.timeoutMs}ms`);
  if (!options.file) {
    await checkRootExists(options.root, options);
  }
  console.log(`[processed-orders] sync start root=${options.root} scope=${options.file || (options.full ? 'full' : options.month || `${options.days}d`)}`);
  console.log('[processed-orders] DB connection start');
  const result = await withClient((client) => {
    console.log('[processed-orders] DB connection success');
    return syncProcessedPrintOrders(client, options);
  });
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
