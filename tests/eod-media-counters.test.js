'use strict';

const assert = require('assert');
const {
  DEFAULT_MEDIA_WIDTH_M,
  inferMediaLengthM,
  summarizeCounterBreakdown,
  summarizeCounterDelta,
} = require('../netlify/functions/_lib/eod-media-counters');

function record(machineId, timestamp, mediaTotalM2, inkTotalLiters, extra = {}) {
  return {
    machine_id: machineId,
    timestamp,
    data: {
      machineId,
      timestamp,
      mediaTotalM2,
      inkTotalLiters,
      ...extra,
    },
  };
}

assert.strictEqual(130 * DEFAULT_MEDIA_WIDTH_M, 208, '130m roll at 1.6m width equals 208 m2');
assert.strictEqual(2 * 130 * DEFAULT_MEDIA_WIDTH_M, 416, 'two 130m rolls equal 416 m2');

{
  const result = summarizeCounterDelta(
    'colorado1',
    record('colorado1', '2026-06-08T06:00:00.000Z', 1000, 5),
    record('colorado1', '2026-06-08T18:00:00.000Z', 1208, 5.5)
  );
  assert.strictEqual(result.deltaMediaAreaM2, 208, 'uses end-start media area delta');
  assert.strictEqual(result.deltaMediaLengthM, 130, 'infers length from area once');
  assert.strictEqual(result.equivalentRolls130m, 1, 'reports 130m roll equivalent');
}

{
  const result = summarizeCounterDelta(
    'colorado1',
    record('colorado1', '2026-06-08T06:00:00.000Z', 1000, 5, { mediaLengthM: 700 }),
    record('colorado1', '2026-06-08T18:00:00.000Z', 1208, 5.5, { mediaLengthM: 830 })
  );
  assert.strictEqual(result.deltaMediaAreaM2, 208, 'area field is already m2 and is not multiplied by width again');
  assert.strictEqual(result.deltaMediaLengthM, 130, 'uses explicit media length when present');
}

{
  const result = summarizeCounterBreakdown({
    colorado1: {
      start: record('colorado1', '2026-06-08T06:00:00.000Z', 1000, 5),
      end: record('colorado1', '2026-06-08T18:00:00.000Z', 1208, 5.5),
    },
    colorado2: {
      start: record('colorado2', '2026-06-08T06:00:00.000Z', 2000, 8),
      end: record('colorado2', '2026-06-08T18:00:00.000Z', 2208, 8.7),
    },
  });
  assert.strictEqual(result.total.deltaMediaAreaM2, 416, 'sums both printers');
  assert.strictEqual(result.total.equivalentRolls130m, 2, 'sums equivalent 130m rolls');
  assert.strictEqual(result.complete, true, 'complete when both printers have valid start/end');
}

{
  const result = summarizeCounterBreakdown({
    colorado1: {
      start: record('colorado1', '2026-06-08T06:00:00.000Z', 1000, 5),
      end: null,
    },
  });
  assert.strictEqual(result.complete, false, 'missing counter does not produce bogus total');
  assert.strictEqual(result.total.deltaMediaAreaM2, null, 'missing counter total is null');
  assert.ok(result.warnings.some((warning) => warning.includes('Missing end')), 'missing end warning is exposed');
}

{
  const result = summarizeCounterDelta(
    'colorado1',
    record('colorado1', '2026-06-08T06:00:00.000Z', 1208, 5.5),
    record('colorado1', '2026-06-08T18:00:00.000Z', 1000, 5.4)
  );
  assert.strictEqual(result.complete, false, 'counter reset is not treated as consumption');
  assert.strictEqual(result.deltaMediaAreaM2, null, 'counter reset produces null consumption');
  assert.ok(result.warnings.some((warning) => warning.includes('Counter reset')), 'counter reset warning is exposed');
}

assert.ok(Math.abs(inferMediaLengthM(807.606, 1.6) - 504.75375) < 0.000001, '807.606 m2 at 1.6m width is 504.75375m media length');

console.log('eod media counter tests passed');
