'use strict';

const { Client } = require('pg');

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

function requireAdminApiKey(event) {
  const expected = getAdminApiKey();
  const provided = getHeader(event, 'x-api-key');
  if (!provided || provided !== expected) {
    const error = new Error('Unauthorized');
    error.statusCode = 401;
    throw error;
  }

  return true;
}

function requireAdminPin(event) {
  return requireAdminApiKey(event);
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
  getAdminApiKey,
  getConnectionString,
  getHeader,
  requireAdminApiKey,
  requireAdminPin,
  json,
  parseRequestBody,
  withClient,
};
