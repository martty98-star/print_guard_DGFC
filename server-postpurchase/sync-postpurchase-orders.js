#!/usr/bin/env node
'use strict';

const { withClient } = require('./lib/db');
const { syncPostPurchaseOrders } = require('./lib/postpurchase-orders');

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) {
      args[key] = true;
      continue;
    }
    args[key] = next;
    index += 1;
  }
  return args;
}

function toPositiveInteger(value, fallback) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) return fallback;
  return parsed;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const syncOptions = {
    fromId: args.fromid ?? args.fromId,
    updatedFrom: args['updated-from'],
    createdFrom: args['created-from'],
    limit: toPositiveInteger(args.limit, 100),
    supplierSystemCode: args['supplier-system-code'],
    log: console.log,
  };

  console.log('[postpurchase] sync start');

  const result = await withClient(async (client) => {
    return syncPostPurchaseOrders(client, syncOptions);
  });

  console.log('[postpurchase] sync success');
  console.log(`[postpurchase] endpoint=${result.endpoint}`);
  console.log(`[postpurchase] fromId=${result.fromId}`);
  console.log(`[postpurchase] fetched=${result.fetched} normalized=${result.normalized} inserted=${result.inserted} updated=${result.updated} skipped=${result.skipped}`);
}

main().catch((error) => {
  console.error('[postpurchase] sync failed');
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
