'use strict';

const http = require('http');
const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');
const { URL } = require('url');

const HOST = process.env.PRINTGUARD_SCAN_HOST || '0.0.0.0';
const PORT = Number(process.env.PRINTGUARD_SCAN_CAPTURE_PORT || 17910);
const OUTPUT_DIR = process.env.PRINTGUARD_SCAN_OUTPUT_DIR || 'C:\\PrintGuard\\Scans';
const INPUT_DIR = process.env.PRINTGUARD_SCAN_INPUT_DIR || OUTPUT_DIR;
const FALLBACK_DIR = process.env.PRINTGUARD_SCAN_FALLBACK_DIR || 'C:\\PrintGuard\\ScansFallback';
const PUBLIC_DIR = path.join(__dirname, 'public');
const ROOT_DIR = path.resolve(__dirname, '..');

function pad2(value) {
  return String(value).padStart(2, '0');
}

function localDateString(date = new Date()) {
  return [
    date.getFullYear(),
    pad2(date.getMonth() + 1),
    pad2(date.getDate()),
  ].join('-');
}

function safeText(value, maxLen = 100) {
  return String(value == null ? '' : value)
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLen);
}

function json(res, statusCode, body) {
  const payload = JSON.stringify(body);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
  res.end(payload);
}

async function ensureOutputDir() {
  await fs.mkdir(OUTPUT_DIR, { recursive: true });
}

async function ensureFallbackDir() {
  await fs.mkdir(FALLBACK_DIR, { recursive: true });
}

function getJsonlPath(date = new Date()) {
  return path.join(OUTPUT_DIR, `job-label-scans-${localDateString(date)}.jsonl`);
}

function getFallbackJsonlPath(date = new Date()) {
  return path.join(FALLBACK_DIR, `failed-scans-${localDateString(date)}.jsonl`);
}

async function appendScanLine(entry) {
  const line = JSON.stringify(entry) + '\n';
  await ensureOutputDir();
  try {
    await fs.appendFile(getJsonlPath(new Date(entry.scannedAt || Date.now())), line, 'utf8');
    return { target: 'nas' };
  } catch (error) {
    await ensureFallbackDir();
    await fs.appendFile(getFallbackJsonlPath(new Date(entry.scannedAt || Date.now())), line, 'utf8');
    const fallbackError = new Error(`NAS write failed, stored locally in fallback queue: ${error.message || error}`);
    fallbackError.statusCode = 503;
    fallbackError.writeTarget = 'fallback';
    fallbackError.cause = error;
    throw fallbackError;
  }
}

async function readRecentScans(count = 10) {
  const filePath = getJsonlPath();
  try {
    const text = await fs.readFile(filePath, 'utf8');
    const lines = text.split(/\r?\n/).filter(Boolean);
    return lines.slice(-count).reverse().map((line) => {
      try {
        return JSON.parse(line);
      } catch (_) {
        return null;
      }
    }).filter(Boolean);
  } catch (error) {
    if (error && error.code === 'ENOENT') return [];
    throw error;
  }
}

async function readBody(req, limitBytes = 8192) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on('data', (chunk) => {
      total += chunk.length;
      if (total > limitBytes) {
        reject(new Error('Payload too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function sanitizeRequestPayload(payload) {
  const rawBarcode = cleanRawBarcode(payload && payload.rawBarcode != null ? payload.rawBarcode : payload && payload.barcode);
  const barcode = cleanBarcode(payload && payload.barcode);
  const operator = safeText(payload && payload.operator, 100);
  const station = safeText(payload && payload.station, 100);
  if (!barcode) {
    const error = new Error('Barcode is required');
    error.statusCode = 400;
    throw error;
  }
  if (barcode.length > 200) {
    const error = new Error('Barcode is too long');
    error.statusCode = 400;
    throw error;
  }
  return { barcode, rawBarcode: rawBarcode || barcode, operator, station };
}

function cleanBarcode(value) {
  return String(value == null ? '' : value).trim().slice(0, 200);
}

function cleanRawBarcode(value) {
  return String(value == null ? '' : value).slice(0, 200);
}

function fileDateFromIso(isoValue) {
  return localDateString(new Date(isoValue || Date.now()));
}

async function rewriteJsonlFile(filePath, predicate) {
  const text = await fs.readFile(filePath, 'utf8');
  const lines = text.split(/\r?\n/).filter(Boolean);
  const keep = [];
  let removed = false;
  for (const line of lines) {
    let parsed = null;
    try {
      parsed = JSON.parse(line);
    } catch (_) {
      keep.push(line);
      continue;
    }
    if (!predicate(parsed)) {
      keep.push(line);
    } else {
      removed = true;
    }
  }
  const tmpPath = `${filePath}.${Date.now()}.tmp`;
  await fs.writeFile(tmpPath, keep.join('\n') + (keep.length ? '\n' : ''), 'utf8');
  await fs.rename(tmpPath, filePath);
  return removed;
}

async function handleScan(req, res) {
  const raw = await readBody(req);
  let payload;
  try {
    payload = raw ? JSON.parse(raw) : {};
  } catch (_) {
    json(res, 400, { ok: false, error: 'Invalid JSON' });
    return;
  }

  try {
    const clean = sanitizeRequestPayload(payload);
    const scannedAt = new Date().toISOString();
    const scanId = crypto.randomUUID();
    const entry = {
      scanId,
      scannedAt,
      barcode: clean.barcode,
      rawBarcode: clean.rawBarcode,
      orderNumber: clean.barcode,
      station: clean.station,
      operator: clean.operator,
      source: 'job_label_scan',
    };
    try {
      const result = await appendScanLine(entry);
      json(res, 200, { ok: true, entry, writeTarget: result.target, outputDir: OUTPUT_DIR, inputDir: INPUT_DIR });
    } catch (error) {
      if (error && error.writeTarget === 'fallback') {
        json(res, 503, {
          ok: false,
          error: error.message || 'NAS write failed',
          entry,
          fallbackDir: FALLBACK_DIR,
          outputDir: OUTPUT_DIR,
          inputDir: INPUT_DIR,
        });
        return;
      }
      throw error;
    }
  } catch (error) {
    json(res, error.statusCode || 500, { ok: false, error: error.message || 'Scan failed' });
  }
}

async function handleDeleteScan(req, res, url) {
  const scanId = cleanBarcode(url.searchParams.get('scanId'));
  const scannedAt = cleanBarcode(url.searchParams.get('scannedAt'));
  if (!scanId) {
    json(res, 400, { ok: false, error: 'scanId is required' });
    return;
  }

  const dateKey = fileDateFromIso(scannedAt);
  const primaryFile = path.join(OUTPUT_DIR, `job-label-scans-${dateKey}.jsonl`);
  const fallbackFile = path.join(FALLBACK_DIR, `failed-scans-${dateKey}.jsonl`);

  let deleted = false;
  let location = null;
  for (const [filePath, fileLocation] of [[primaryFile, 'nas'], [fallbackFile, 'fallback']]) {
    try {
      deleted = await rewriteJsonlFile(filePath, (row) => String(row && row.scanId || '') === scanId);
      if (deleted) {
        location = fileLocation;
        break;
      }
    } catch (error) {
      if (error && error.code === 'ENOENT') continue;
      throw error;
    }
  }

  if (!deleted) {
    json(res, 404, { ok: false, error: 'Scan not found' });
    return;
  }

  json(res, 200, { ok: true, deleted: true, scanId, location });
}

function sendHealth(res) {
  json(res, 200, { ok: true, service: 'printguard-scan-capture' });
}

function contentTypeFor(filePath) {
  if (filePath.endsWith('.html')) return 'text/html; charset=utf-8';
  if (filePath.endsWith('.js')) return 'text/javascript; charset=utf-8';
  if (filePath.endsWith('.css')) return 'text/css; charset=utf-8';
  if (filePath.endsWith('.json')) return 'application/json; charset=utf-8';
  return 'application/octet-stream';
}

async function serveStatic(req, res, pathname) {
  const filePath = pathname === '/' ? path.join(PUBLIC_DIR, 'index.html') : path.join(PUBLIC_DIR, pathname);
  const resolved = path.resolve(filePath);
  if (!resolved.startsWith(path.resolve(PUBLIC_DIR))) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }
  try {
    const data = await fs.readFile(resolved);
    res.writeHead(200, {
      'Content-Type': contentTypeFor(resolved),
      'Cache-Control': 'no-store',
    });
    res.end(data);
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found');
      return;
    }
    throw error;
  }
}

async function serveRootStyles(req, res) {
  const filePath = path.join(PUBLIC_DIR, 'styles.css');
  try {
    const data = await fs.readFile(filePath);
    res.writeHead(200, {
      'Content-Type': 'text/css; charset=utf-8',
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': '*',
    });
    res.end(data);
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found');
      return;
    }
    throw error;
  }
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    if (req.method === 'OPTIONS') {
      json(res, 204, {});
      return;
    }
    if (req.method === 'GET' && url.pathname === '/health') {
      sendHealth(res);
      return;
    }
    if (req.method === 'GET' && url.pathname === '/styles.css') {
      await serveRootStyles(req, res);
      return;
    }
    if (req.method === 'POST' && url.pathname === '/scan') {
      await handleScan(req, res);
      return;
    }
    if (req.method === 'DELETE' && url.pathname === '/scan') {
      await handleDeleteScan(req, res, url);
      return;
    }
    if (req.method === 'GET' && url.pathname === '/recent') {
      const count = Math.max(1, Math.min(50, Number(url.searchParams.get('count') || 10)));
      const scans = await readRecentScans(count);
      json(res, 200, { ok: true, scans, outputDir: OUTPUT_DIR, inputDir: INPUT_DIR, fallbackDir: FALLBACK_DIR });
      return;
    }
    if (req.method === 'GET' || req.method === 'HEAD') {
      await serveStatic(req, res, url.pathname);
      return;
    }
    json(res, 405, { ok: false, error: 'Method not allowed' });
  } catch (error) {
    console.error('[scan-capture] request failed', error);
    if (!res.headersSent) {
      json(res, 500, { ok: false, error: 'Internal server error' });
    } else {
      res.end();
    }
  }
});

ensureOutputDir().catch((error) => {
  console.error('[scan-capture] failed to create output dir', error);
  process.exit(1);
});

server.listen(PORT, () => {
  console.log(`PrintGuard Scan Capture listening on http://${HOST}:${PORT}`);
  console.log(`[scan-capture] output dir: ${OUTPUT_DIR}`);
  console.log(`[scan-capture] input dir: ${INPUT_DIR}`);
  console.log(`[scan-capture] fallback dir: ${FALLBACK_DIR}`);
});
