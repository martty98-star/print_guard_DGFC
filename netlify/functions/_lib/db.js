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
  getConnectionString,
  json,
  parseRequestBody,
  withClient,
};
