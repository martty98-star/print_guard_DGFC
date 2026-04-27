'use strict';

const { json, parseRequestBody, requireAdminPin, withClient } = require('./_lib/db');

exports.handler = async function handler(event) {
  if (event.httpMethod === 'OPTIONS') {
    return json(204, {});
  }

  try {
    if (event.httpMethod !== 'DELETE') {
      return json(405, { ok: false, error: 'Method not allowed' }, { allow: 'DELETE,OPTIONS' });
    }

    requireAdminPin(event);

    const requestBody = parseRequestBody(event);
    const id = String(requestBody.id || event.queryStringParameters?.id || '').trim();

    if (!id) {
      return json(400, { ok: false, error: 'Missing movement id' });
    }

    const body = await withClient(async (client) => {
      const result = await client.query(
        'delete from public.pg_movements where id = $1',
        [id]
      );

      return {
        ok: true,
        deleted: result.rowCount > 0,
      };
    });

    return json(200, body);
  } catch (error) {
    if (error && (error.statusCode === 401 || error.statusCode === 429)) {
      return json(error.statusCode, { ok: false, error: error.message || 'Unauthorized' });
    }
    console.error('delete-stock-movement failed', error);
    return json(500, {
      ok: false,
      error: error && error.message ? error.message : 'delete-stock-movement failed',
    });
  }
};
