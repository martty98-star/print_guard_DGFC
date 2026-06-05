'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'order-pipeline-render.js'), 'utf8');
const context = {
  window: {
    I18N: { t: (key) => key },
  },
};
vm.createContext(context);
vm.runInContext(source, context);

const Render = context.window.PrintGuardOrderPipelineRender;
const esc = (value) => String(value == null ? '' : value)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

const html = Render.renderOrders([{
  id: 26850,
  processedOrderId: 26850,
  processedOrderName: '26850',
  orderName: '4770994',
  externalOrderId: '4770994',
  customerOrderId: 'PS4770994',
  pipelineStatus: 'processed',
}], {
  esc,
  stats: null,
  reprintHistoryByKey: new Map(),
  reprintActionStateByKey: new Map(),
  reprintPendingKeys: new Set(),
});

assert.match(html, /<div class="pp-order-main">PS4770994<\/div>/);
assert.match(html, /<div class="pp-order-sub">4770994<\/div>/);
assert.doesNotMatch(html, /<div class="pp-order-main">26850<\/div>/);

const prefixedHtml = Render.renderOrders([{
  id: 26850,
  processedOrderId: 26850,
  processedOrderName: 'PS4770994',
  orderName: '4770994',
  externalOrderId: '4770994',
  pipelineStatus: 'processed',
}], {
  esc,
  stats: null,
  reprintHistoryByKey: new Map(),
  reprintActionStateByKey: new Map(),
  reprintPendingKeys: new Set(),
});

assert.match(prefixedHtml, /<div class="pp-order-main">PS4770994<\/div>/);
assert.match(prefixedHtml, /<div class="pp-order-sub">4770994<\/div>/);

const smartReprintHtml = Render.renderOrders([{
  id: 26851,
  processedOrderId: 26851,
  processedOrderName: '4770994',
  orderName: '4770994',
  orderType: 'RS',
  pipelineStatus: 'processed',
}], {
  esc,
  stats: null,
  reprintHistoryByKey: new Map(),
  reprintActionStateByKey: new Map(),
  reprintPendingKeys: new Set(),
});

assert.match(smartReprintHtml, /<span class="pp-order-chip reprint-single is-reprint-single">RS<\/span>/);

console.log('order-pipeline render label tests passed');
