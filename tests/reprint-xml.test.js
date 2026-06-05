'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'reprint-xml.js'), 'utf8');
const context = {
  Blob: class BlobMock {},
  URL: {
    createObjectURL: () => 'blob:test',
    revokeObjectURL: () => {},
  },
  document: {
    createElement: () => ({ click() {}, remove() {} }),
    body: { appendChild() {} },
  },
  window: {
    setTimeout: () => {},
  },
};
vm.createContext(context);
vm.runInContext(source, context);

const ReprintXml = context.window.PrintGuardReprintXml;

function sampleOrder(orderType) {
  return {
    orderName: '123456',
    externalOrderId: '123456',
    orderType,
    printFiles: [{
      printFilePath: '\\\\nas\\processed\\123456.pdf',
      pageSize: '500x700',
      copies: 1,
    }],
  };
}

assert.strictEqual(ReprintXml.getReprintOrderType(sampleOrder('S')), 'RS');
assert.strictEqual(ReprintXml.getReprintOrderType(sampleOrder('C')), 'RC');
assert.strictEqual(ReprintXml.getReprintOrderType(sampleOrder('RS')), 'RS');
assert.strictEqual(ReprintXml.getReprintOrderType(sampleOrder('RC')), 'RC');
assert.strictEqual(ReprintXml.getReprintOrderType(sampleOrder('R')), 'R');
assert.strictEqual(ReprintXml.getReprintOrderType(sampleOrder('')), 'R');
assert.strictEqual(ReprintXml.getReprintOriginalPoNumber({ orderName: '26967599', orderType: 'S' }), '26967599');
assert.strictEqual(ReprintXml.getReprintScanBarcode({ orderName: 'PS4775605', orderType: 'S' }), 'PS4775605RS');
assert.strictEqual(ReprintXml.getReprintScanBarcode({ orderName: 'PS4775605', orderType: 'C' }), 'PS4775605RC');
assert.strictEqual(ReprintXml.getReprintScanBarcode({ orderName: 'PS4775605RS', orderType: 'RS' }), 'PS4775605RS');

assert.match(ReprintXml.generateReprintXml(sampleOrder('S')), /OrderType="RS"/);
assert.match(ReprintXml.generateReprintXml(sampleOrder('C')), /OrderType="RC"/);
assert.match(ReprintXml.generateReprintXml(sampleOrder('R')), /OrderType="R"/);
assert.match(ReprintXml.generateReprintXml({ orderName: '26967599', orderType: 'S' }), /OrderType="RS"/);
assert.match(ReprintXml.generateReprintXml({ orderName: '26967599', orderType: 'S' }), /PoNumber="26967599RS"/);
assert.match(ReprintXml.generateReprintXml({ orderName: '26967599', orderType: 'S' }), /OriginalPoNumber="26967599"/);
assert.match(ReprintXml.generateReprintXml({ orderName: '26967599', orderType: 'C' }), /OrderType="RC"/);
assert.match(ReprintXml.generateReprintXml({ orderName: '26967599', orderType: 'C' }), /PoNumber="26967599RC"/);
assert.match(ReprintXml.generateReprintXml({ orderName: '26967599', orderType: 'C' }), /OriginalPoNumber="26967599"/);
assert.match(ReprintXml.generateReprintXml({ orderName: '26967599', orderType: 'R' }), /OrderType="R"/);
assert.match(ReprintXml.generateReprintXml({ orderName: '26967599', orderType: 'R' }), /PoNumber="26967599R"/);
assert.match(ReprintXml.generateReprintXml({ orderName: '26967599', orderType: 'R' }), /OriginalPoNumber="26967599"/);
assert.match(ReprintXml.generateReprintXml({ orderName: 'PS4775605', orderType: 'S' }), /ScanBarcode="PS4775605RS"/);
assert.match(ReprintXml.generateReprintXml({ orderName: 'PS4775605', orderType: 'C' }), /ScanBarcode="PS4775605RC"/);

console.log('reprint XML tests passed');
