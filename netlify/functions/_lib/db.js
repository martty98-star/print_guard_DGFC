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

function getAdminPin() {
  const value =
    process.env.PRINTGUARD_ADMIN_PIN ||
    process.env.NETLIFY_PRINTGUARD_ADMIN_PIN ||
    process.env.PG_ADMIN_PIN ||
    '';

  return typeof value === 'string' ? value.trim() : '';
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

function requireAdminPin(event) {
  const expected = getAdminPin();
  if (!expected) {
    throw new Error('Missing admin PIN configuration');
  }

  const provided = getHeader(event, 'x-printguard-admin-pin');
  if (!provided || provided !== expected) {
    const error = new Error('Forbidden');
    error.statusCode = 403;
    throw error;
  }

  return true;
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
  getAdminPin,
  getConnectionString,
  requireAdminPin,
  json,
  parseRequestBody,
  withClient,
};
