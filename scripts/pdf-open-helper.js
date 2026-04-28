#!/usr/bin/env node
'use strict';

const http = require('http');
const { spawn } = require('child_process');

const HOST = '127.0.0.1';
const PORT = Number(process.env.PRINTGUARD_PDF_HELPER_PORT || 17891);

function sendJson(res, statusCode, body) {
  res.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'POST,OPTIONS',
    'access-control-allow-headers': 'content-type',
    'cache-control': 'no-store',
  });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 8192) {
        reject(new Error('Request body too large'));
        req.destroy();
      }
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

function isAllowedPdfPath(value) {
  const raw = String(value || '').trim();
  if (!raw || !/\.pdf$/i.test(raw)) return false;
  return /^\\\\[^\\]+\\Data\\onyx\\prints\\/i.test(raw) ||
    /^\\\\10\.25\.0\.20\\Data\\onyx\\prints\\/i.test(raw);
}

function openPdf(pdfPath) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', 'Start-Process -LiteralPath $args[0]', pdfPath],
      { windowsHide: true }
    );
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Start-Process exited with ${code}`));
    });
  });
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    sendJson(res, 204, {});
    return;
  }

  if (req.method !== 'POST' || req.url !== '/open-pdf') {
    sendJson(res, 404, { ok: false, error: 'Not found' });
    return;
  }

  try {
    const payload = JSON.parse(await readBody(req) || '{}');
    const pdfPath = String(payload.path || '').trim();
    if (!isAllowedPdfPath(pdfPath)) {
      sendJson(res, 400, { ok: false, error: 'PDF path is not allowed' });
      return;
    }

    await openPdf(pdfPath);
    sendJson(res, 200, { ok: true });
  } catch (error) {
    console.error('[pdf-helper] open failed', error);
    sendJson(res, 500, { ok: false, error: 'Open PDF failed' });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`[pdf-helper] listening on http://${HOST}:${PORT}`);
});
