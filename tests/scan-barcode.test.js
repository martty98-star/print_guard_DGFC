'use strict';

const assert = require('assert');
const { parseBarcode } = require('../netlify/functions/_lib/scan-barcode');

assert.deepStrictEqual(parseBarcode('123456'), {
  ok: true,
  rawBarcode: '123456',
  barcode: '123456',
  poNumber: '123456',
  orderType: null,
  isReprint: false,
  reprintKind: null,
});

assert.deepStrictEqual(parseBarcode('123456-S'), {
  ok: true,
  rawBarcode: '123456-S',
  barcode: '123456-S',
  poNumber: '123456',
  orderType: 'S',
  isReprint: false,
  reprintKind: null,
});

assert.deepStrictEqual(parseBarcode('123456-C'), {
  ok: true,
  rawBarcode: '123456-C',
  barcode: '123456-C',
  poNumber: '123456',
  orderType: 'C',
  isReprint: false,
  reprintKind: null,
});

assert.deepStrictEqual(parseBarcode('123456-R'), {
  ok: true,
  rawBarcode: '123456-R',
  barcode: '123456-R',
  poNumber: '123456',
  orderType: 'R',
  isReprint: true,
  reprintKind: 'unknown',
});

assert.deepStrictEqual(parseBarcode('123456-RS'), {
  ok: true,
  rawBarcode: '123456-RS',
  barcode: '123456-RS',
  poNumber: '123456',
  orderType: 'RS',
  isReprint: true,
  reprintKind: 'single',
});

assert.deepStrictEqual(parseBarcode('123456-RC'), {
  ok: true,
  rawBarcode: '123456-RC',
  barcode: '123456-RC',
  poNumber: '123456',
  orderType: 'RC',
  isReprint: true,
  reprintKind: 'combi',
});

assert.deepStrictEqual(parseBarcode('*123456-RS*'), {
  ok: true,
  rawBarcode: '*123456-RS*',
  barcode: '123456-RS',
  poNumber: '123456',
  orderType: 'RS',
  isReprint: true,
  reprintKind: 'single',
});

assert.deepStrictEqual(parseBarcode('PO-123456-RC'), {
  ok: true,
  rawBarcode: 'PO-123456-RC',
  barcode: 'PO-123456-RC',
  poNumber: 'PO-123456',
  orderType: 'RC',
  isReprint: true,
  reprintKind: 'combi',
});

assert.deepStrictEqual(parseBarcode('PS4775605RS'), {
  ok: true,
  rawBarcode: 'PS4775605RS',
  barcode: 'PS4775605RS',
  poNumber: 'PS4775605',
  orderType: 'RS',
  isReprint: true,
  reprintKind: 'single',
});

assert.deepStrictEqual(parseBarcode('PS4775605RC'), {
  ok: true,
  rawBarcode: 'PS4775605RC',
  barcode: 'PS4775605RC',
  poNumber: 'PS4775605',
  orderType: 'RC',
  isReprint: true,
  reprintKind: 'combi',
});

assert.deepStrictEqual(parseBarcode('26967599RC'), {
  ok: true,
  rawBarcode: '26967599RC',
  barcode: '26967599RC',
  poNumber: '26967599',
  orderType: 'RC',
  isReprint: true,
  reprintKind: 'combi',
});

assert.deepStrictEqual(parseBarcode('26967599R'), {
  ok: true,
  rawBarcode: '26967599R',
  barcode: '26967599R',
  poNumber: '26967599',
  orderType: 'R',
  isReprint: true,
  reprintKind: 'unknown',
});

assert.strictEqual(parseBarcode('123456-XYZ').ok, false);
assert.match(
  parseBarcode('123456-XYZ').error,
  /unsupported barcode order type suffix/,
);

console.log('scan barcode parser tests passed');
