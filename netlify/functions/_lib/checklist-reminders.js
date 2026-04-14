'use strict';

const checklistDomain = require('../../../reports/checklist-domain.js');
const {
  ensureChecklistTables,
  finalizeChecklistOccurrence,
  listChecklistItems,
  reserveChecklistOccurrence,
} = require('./checklist-store');
const { sendPushToMatchingSubscriptions } = require('./push-delivery');

async function evaluateChecklistReminders(client, options) {
  const now = options && options.now ? new Date(options.now) : new Date();
  const lookbackMinutes = Math.max(1, Number(options && options.lookbackMinutes) || 15);
  const reminderUrl = typeof options?.url === 'string' && options.url.trim()
    ? options.url.trim()
    : '/?mode=stock&screen=checklist';
  const dryRun = options && options.dryRun === true;

  await ensureChecklistTables(client);

  const items = await listChecklistItems(client);
  const dueOccurrences = checklistDomain.evaluateDueChecklistOccurrences(items, {
    now,
    lookbackMinutes,
  });

  const summary = {
    now: now.toISOString(),
    lookbackMinutes,
    itemsScanned: items.length,
    dueOccurrences: dueOccurrences.length,
    attemptedOccurrences: 0,
    reservedOccurrences: 0,
    duplicateOccurrences: 0,
    sent: 0,
    failed: 0,
    noSubscriptions: 0,
    dryRun,
    results: [],
  };

  for (const occurrence of dueOccurrences) {
    summary.attemptedOccurrences += 1;

    const event = checklistDomain.buildChecklistReminderEvent(occurrence, reminderUrl);
    const reserved = dryRun
      ? true
      : await reserveChecklistOccurrence(client, occurrence, event);

    if (!reserved) {
      summary.duplicateOccurrences += 1;
      summary.results.push({
        occurrenceKey: occurrence.occurrenceKey,
        checklistId: occurrence.checklistId,
        status: 'duplicate',
      });
      continue;
    }

    summary.reservedOccurrences += 1;

    if (dryRun) {
      summary.results.push({
        occurrenceKey: occurrence.occurrenceKey,
        checklistId: occurrence.checklistId,
        status: 'dry_run',
        payload: event,
      });
      continue;
    }

    try {
      const delivery = await sendPushToMatchingSubscriptions(client, 'checklist', event);
      const status = delivery.matchedSubscriptions === 0
        ? 'no_subscriptions'
        : delivery.sent > 0
          ? 'sent'
          : 'failed';

      if (status === 'no_subscriptions') {
        summary.noSubscriptions += 1;
      }
      if (delivery.sent > 0) {
        summary.sent += delivery.sent;
      }
      if (delivery.failed > 0) {
        summary.failed += delivery.failed;
      }

      await finalizeChecklistOccurrence(client, occurrence.occurrenceKey, {
        status,
        matchedSubscriptions: delivery.matchedSubscriptions,
        sent: delivery.sent,
        failed: delivery.failed,
        payload: event,
      });

      summary.results.push({
        occurrenceKey: occurrence.occurrenceKey,
        checklistId: occurrence.checklistId,
        status,
        matchedSubscriptions: delivery.matchedSubscriptions,
        sent: delivery.sent,
        failed: delivery.failed,
      });
    } catch (error) {
      await finalizeChecklistOccurrence(client, occurrence.occurrenceKey, {
        status: 'failed',
        matchedSubscriptions: 0,
        sent: 0,
        failed: 1,
        payload: event,
        error: error && error.message ? error.message : String(error),
      });

      summary.failed += 1;
      summary.results.push({
        occurrenceKey: occurrence.occurrenceKey,
        checklistId: occurrence.checklistId,
        status: 'failed',
        error: error && error.message ? error.message : String(error),
      });
    }
  }

  return summary;
}

module.exports = {
  evaluateChecklistReminders,
};
