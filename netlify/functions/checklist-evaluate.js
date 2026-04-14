'use strict';

const { json, parseRequestBody, withClient } = require('./_lib/db');
const { evaluateChecklistReminders } = require('./_lib/checklist-reminders');

exports.handler = async function handler(event) {
  if (event.httpMethod === 'OPTIONS') {
    return json(204, {});
  }

  if (event.httpMethod !== 'GET' && event.httpMethod !== 'POST') {
    return json(405, { ok: false, error: 'Method not allowed' }, { allow: 'GET,POST,OPTIONS' });
  }

  try {
    const bodyInput = event.httpMethod === 'POST' ? parseRequestBody(event) : {};
    const query = event.queryStringParameters || {};
    const lookbackRaw = bodyInput.lookbackMinutes ?? query.lookbackMinutes;
    const dryRunRaw = bodyInput.dryRun ?? query.dryRun;
    const lookbackMinutes = Math.max(1, Number(lookbackRaw) || 15);
    const dryRun = dryRunRaw === true || dryRunRaw === 'true' || dryRunRaw === '1';

    const body = await withClient(async (client) => {
      const result = await evaluateChecklistReminders(client, {
        lookbackMinutes,
        dryRun,
        url: '/?mode=stock&screen=checklist',
      });
      return { ok: true, ...result };
    });

    return json(200, body);
  } catch (error) {
    console.error('checklist-evaluate failed', error);
    return json(500, {
      ok: false,
      error: error && error.message ? error.message : 'checklist-evaluate failed',
    });
  }
};
