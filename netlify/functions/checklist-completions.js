'use strict';

const { json, parseRequestBody, withClient } = require('./_lib/db');
const {
  completeChecklistOccurrence,
  listChecklistCompletions,
} = require('./_lib/checklist-store');

function getActor(event, body) {
  const headerValue = event && event.headers
    ? event.headers['x-printguard-actor'] || event.headers['X-PrintGuard-Actor']
    : null;
  const bodyValue = body && typeof body.actor === 'string' ? body.actor : null;
  const completedByValue = body && typeof body.completed_by === 'string' ? body.completed_by : null;
  const actor = bodyValue || completedByValue || headerValue || 'printguard-user';
  return typeof actor === 'string' && actor.trim() ? actor.trim() : 'printguard-user';
}

exports.handler = async function handler(event) {
  if (event.httpMethod === 'OPTIONS') {
    return json(204, {});
  }

  try {
    if (event.httpMethod === 'GET') {
      const query = event.queryStringParameters || {};
      const limit = Math.max(1, Number(query.limit) || 50);
      const body = await withClient(async (client) => {
        const completions = await listChecklistCompletions(client, limit);
        return { ok: true, completions };
      });
      return json(200, body);
    }

    if (event.httpMethod !== 'POST') {
      return json(405, { ok: false, error: 'Method not allowed' }, { allow: 'GET,POST,OPTIONS' });
    }

    const requestBody = parseRequestBody(event);
    const checklistId = String(requestBody.checklist_id || requestBody.checklistId || '').trim();
    const occurrenceKey = String(requestBody.occurrence_key || requestBody.occurrenceKey || '').trim();
    const deviceId = String(requestBody.device_id || requestBody.deviceId || '').trim();
    const completedAt = String(requestBody.completed_at || requestBody.completedAt || new Date().toISOString()).trim();
    const completedBy = getActor(event, requestBody);
    const checklistTitle = String(requestBody.checklist_title || requestBody.checklistTitle || '').trim();

    if (!checklistId || !occurrenceKey || !deviceId) {
      return json(400, { ok: false, error: 'Missing checklist completion fields' });
    }

    const body = await withClient(async (client) => {
      const completed = await completeChecklistOccurrence(client, {
        checklistId,
        checklistTitle,
        occurrenceKey,
        completedAt,
        completedBy,
        deviceId,
      });

      if (!completed) {
        return { ok: false, error: 'Checklist occurrence already completed' };
      }

      return {
        ok: true,
        completion: {
          checklist_id: checklistId,
          checklist_title: checklistTitle,
          occurrence_key: occurrenceKey,
          completed_at: completedAt,
          completed_by: completedBy,
          device_id: deviceId,
        },
      };
    });

    return body.ok ? json(200, body) : json(409, body);
  } catch (error) {
    console.error('checklist-completions failed', error);
    return json(500, {
      ok: false,
      error: error && error.message ? error.message : 'checklist-completions failed',
    });
  }
};
