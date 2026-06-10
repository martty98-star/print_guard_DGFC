'use strict';

const assert = require('assert');

global.window = global;
require('../scripts/scan-capture-api.js');

function response(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() {
      return JSON.stringify(body);
    },
  };
}

async function run() {
  const api = global.PrintGuardScanCaptureApi;
  assert.ok(api, 'scan capture API should attach to window/global');

  {
    const fetchImpl = (_url, options = {}) =>
      new Promise((_resolve, reject) => {
        options.signal.addEventListener('abort', () => {
          const error = new Error('aborted');
          error.name = 'AbortError';
          reject(error);
        });
      });
    let caught = null;
    try {
      await api.commitScanBatch({
        fetchImpl,
        batchId: 'browser-scan-batch-timeout-test',
        scans: [],
        timeoutMs: 5,
      });
    } catch (error) {
      caught = error;
    }
    assert.ok(caught, 'commit timeout should throw');
    assert.strictEqual(caught.isTimeout, true);
  }

  {
    const status = await api.getScanBatchStatus({
      batchId: 'browser-scan-batch-status-test',
      fetchImpl: async (url, options) => {
        assert.strictEqual(options.method, 'GET');
        assert.ok(
          String(url).includes('batchId=browser-scan-batch-status-test'),
        );
        return response(200, {
          ok: true,
          batchId: 'browser-scan-batch-status-test',
          status: 'matched',
          matchedCount: 2,
        });
      },
    });
    assert.strictEqual(status.status, 'matched');
    assert.strictEqual(status.matchedCount, 2);
  }
}

run()
  .then(() => {
    console.log('scan capture API tests passed');
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
