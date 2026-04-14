'use strict';

const { json, parseRequestBody, withClient } = require('./_lib/db');
const {
  deleteChecklistItem,
  listChecklistItems,
  saveChecklistItem,
} = require('./_lib/checklist-store');

function getActor(event, body) {
  const headerValue = event && event.headers
    ? event.headers['x-printguard-actor'] || event.headers['X-PrintGuard-Actor']
    : null;
  const bodyValue = body && typeof body.actor === 'string' ? body.actor : null;
  const actor = bodyValue || headerValue || 'printguard-admin';
  return typeof actor === 'string' && actor.trim() ? actor.trim() : 'printguard-admin';
}

exports.handler = async function handler(event) {
  if (event.httpMethod === 'OPTIONS') {
    return json(204, {});
  }

  try {
    if (event.httpMethod === 'GET') {
      const body = await withClient(async (client) => {
        const items = await listChecklistItems(client);
        return { ok: true, items };
      });
      return json(200, body);
    }

    if (event.httpMethod === 'POST' || event.httpMethod === 'PUT') {
      const requestBody = parseRequestBody(event);
      const actor = getActor(event, requestBody);
      const body = await withClient(async (client) => {
        const item = await saveChecklistItem(client, requestBody.item || requestBody, actor);
        return { ok: true, item };
      });
      return json(200, body);
    }

    if (event.httpMethod === 'DELETE') {
      const requestBody = parseRequestBody(event);
      const id = String(
        requestBody.id ||
        event.queryStringParameters?.id ||
        ''
      ).trim();

      if (!id) {
        return json(400, { ok: false, error: 'Missing checklist id' });
      }

      const body = await withClient(async (client) => {
        const deleted = await deleteChecklistItem(client, id);
        return { ok: true, deleted };
      });
      return json(200, body);
    }

    return json(405, { ok: false, error: 'Method not allowed' }, { allow: 'GET,POST,PUT,DELETE,OPTIONS' });
  } catch (error) {
    console.error('checklist-items failed', error);
    return json(500, {
      ok: false,
      error: error && error.message ? error.message : 'checklist-items failed',
    });
  }
};
