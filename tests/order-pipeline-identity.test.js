'use strict';

const assert = require('assert');
const {
  getCanonicalOrderIdentity,
  normalizeOrderIdentityCandidate,
} = require('../netlify/functions/_lib/order-pipeline');

assert.strictEqual(normalizeOrderIdentityCandidate('PS26902139'), 'PS26902139');
assert.strictEqual(normalizeOrderIdentityCandidate('ps_26902139'), 'PS26902139');
assert.strictEqual(normalizeOrderIdentityCandidate('26902139'), '26902139');
assert.strictEqual(normalizeOrderIdentityCandidate('4770220_REPRINT'), '4770220');
assert.strictEqual(normalizeOrderIdentityCandidate('26902139_retry2'), '26902139');
assert.strictEqual(normalizeOrderIdentityCandidate('C:\\processed\\26902139_REPRINT.xml'), null);
assert.strictEqual(normalizeOrderIdentityCandidate('26902139.xml'), null);
assert.strictEqual(normalizeOrderIdentityCandidate('ONYX_RETRY_2026_05_26'), null);

assert.strictEqual(getCanonicalOrderIdentity({
  order_number: 'C:\\processed\\26902139.xml',
  external_order_id: 'PS26902139',
  processed_order_name: '26902139_REPRINT',
}), 'PS26902139');

assert.strictEqual(getCanonicalOrderIdentity({
  order_number: '4770220_REPRINT',
  external_order_id: '',
  processed_order_name: '4770220_REPRINT.xml',
}), '4770220');

assert.strictEqual(getCanonicalOrderIdentity({
  order_number: 'SubmitTool_retry.xml',
  external_order_id: '',
  processed_order_name: 'retry_2026_05_26',
}), null);

console.log('order-pipeline identity tests passed');
