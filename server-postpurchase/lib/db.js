'use strict';

const { Client } = require('pg');

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
  withClient,
};
