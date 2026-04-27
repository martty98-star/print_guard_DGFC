'use strict';

const { Client } = require('pg');
const crypto = require('crypto');

function json(statusCode, body, extraHeaders) {
  return {
    statusCode,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...extraHeaders,
    },
    body: JSON.stringify(body),
  };
}

function parseRequestBody(event) {
  if (!event || event.body == null || event.body === '') {
    return {};
  }

  if (typeof event.body === 'object') {
    return event.body;
  }

  const rawBody = event.isBase64Encoded
    ? Buffer.from(event.body, 'base64').toString('utf8')
    : event.body;

  return JSON.parse(rawBody);
}

function getConnectionString() {
  const value =
    process.env.NETLIFY_DATABASE_URL ||
    process.env.DATABASE_URL ||
    process.env.NEON_DATABASE_URL ||
    '';

  return typeof value === 'string' ? value.trim() : '';
}

const rateLimitBuckets = new Map();

function getAdminApiKey() {
  const value = process.env.ADMIN_API_KEY || '';
  const key = typeof value === 'string' ? value.trim() : '';
  if (!key) {
    throw new Error('ADMIN_API_KEY is not configured');
  }
  return key;
}

function getAdminPin() {
  const value = process.env.ADMIN_PIN || '';
  const pin = typeof value === 'string' ? value.trim() : '';
  if (!pin) {
    throw new Error('ADMIN_PIN is not configured');
  }
  return pin;
}

function getPostPurchaseOperatorPin() {
  const value = process.env.POSTPURCHASE_OPERATOR_PIN || process.env.POSTPURCHASE_PIN || '';
  const pin = typeof value === 'string' ? value.trim() : '';
  if (!pin) {
    throw new Error('POSTPURCHASE_OPERATOR_PIN is not configured');
  }
  return pin;
}

function getHeader(event, name) {
  if (!event || !event.headers) return '';
  const lower = String(name || '').toLowerCase();
  for (const [key, value] of Object.entries(event.headers)) {
    if (String(key).toLowerCase() === lower) {
      return typeof value === 'string' ? value.trim() : '';
    }
  }
  return '';
}

function getRequestIdentity(event) {
  return getHeader(event, 'x-forwarded-for').split(',')[0].trim() ||
    getHeader(event, 'client-ip') ||
    'unknown';
}

function checkRateLimit(event, options = {}) {
  const windowMs = options.windowMs || 60 * 1000;
  const maxRequests = options.maxRequests || 30;
  const now = Date.now();
  const identity = getRequestIdentity(event);
  const key = `${options.name || 'default'}:${identity}`;
  const bucket = rateLimitBuckets.get(key);

  if (!bucket || now > bucket.resetAt) {
    rateLimitBuckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }

  bucket.count += 1;
  if (bucket.count > maxRequests) {
    const error = new Error('Too many requests');
    error.statusCode = 429;
    throw error;
  }

  return true;
}

function timingSafeEqualString(left, right) {
  const leftBuffer = Buffer.from(String(left || ''), 'utf8');
  const rightBuffer = Buffer.from(String(right || ''), 'utf8');
  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function createAuthError(message, statusCode) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function checkAdminApiKey(event) {
  const provided = getHeader(event, 'x-api-key');
  if (!provided) {
    return { ok: false };
  }

  const expected = getAdminApiKey();
  return timingSafeEqualString(provided, expected)
    ? { ok: true, method: 'api-key' }
    : { ok: false };
}

function checkAdminPin(event) {
  const provided = getHeader(event, 'x-admin-pin');
  if (!provided) {
    return { ok: false };
  }

  const expected = getAdminPin();
  return timingSafeEqualString(provided, expected)
    ? { ok: true, method: 'pin' }
    : { ok: false };
}

function checkPostPurchaseOperatorPin(event) {
  const provided = getHeader(event, 'x-postpurchase-pin');
  if (!provided) {
    return { ok: false };
  }

  const expected = getPostPurchaseOperatorPin();
  return timingSafeEqualString(provided, expected)
    ? { ok: true, method: 'postpurchase-pin' }
    : { ok: false };
}

function requireAdminApiKey(event) {
  const result = checkAdminApiKey(event);
  if (!result.ok) {
    throw createAuthError('Unauthorized', 401);
  }
  return result;
}

function requireAdminAccess(event) {
  const apiKeyResult = checkAdminApiKey(event);
  if (apiKeyResult.ok) return apiKeyResult;

  const pinResult = checkAdminPin(event);
  if (pinResult.ok) return pinResult;

  throw createAuthError('Unauthorized', 401);
}

function requirePostPurchaseAccess(event) {
  const apiKeyResult = checkAdminApiKey(event);
  if (apiKeyResult.ok) return apiKeyResult;

  const adminPinResult = checkAdminPin(event);
  if (adminPinResult.ok) return adminPinResult;

  const operatorPinResult = checkPostPurchaseOperatorPin(event);
  if (operatorPinResult.ok) return operatorPinResult;

  throw createAuthError('Unauthorized', 401);
}

function requireAdminPin(event) {
  return requireAdminAccess(event);
}

async function withClient(run) {
  const connectionString = getConnectionString();
  if (!connectionString) {
    throw new Error('Missing database connection string');
  }

  const client = new Client({
    connectionString,
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();

  try {
    return await run(client);
  } finally {
    await client.end().catch(() => {});
  }
}

module.exports = {
  checkRateLimit,
  checkAdminApiKey,
  checkAdminPin,
  checkPostPurchaseOperatorPin,
  getAdminApiKey,
  getAdminPin,
  getConnectionString,
  getHeader,
  getPostPurchaseOperatorPin,
  requireAdminAccess,
  requireAdminApiKey,
  requireAdminPin,
  requirePostPurchaseAccess,
  json,
  parseRequestBody,
  withClient,
};
