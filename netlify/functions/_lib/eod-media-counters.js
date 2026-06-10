'use strict';

const COLORADO_ROLL_LENGTH_M = 130;
const DEFAULT_MEDIA_WIDTH_M = 1.6;

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function round(value, digits = 3) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  const factor = 10 ** digits;
  return Math.round(n * factor) / factor;
}

function readCounterRecord(row) {
  if (!row) return null;
  const data = row.data || {};
  const mediaAreaM2 = num(
    data.mediaTotalM2 ??
      data.media_total_m2 ??
      data.mediaAreaM2 ??
      data.media_area_m2,
  );
  const mediaLengthM = num(
    data.mediaTotalLengthM ??
      data.media_total_length_m ??
      data.mediaLengthM ??
      data.media_length_m,
  );
  const inkTotalL = num(
    data.inkTotalLiters ??
      data.ink_total_liters ??
      data.inkTotalL ??
      data.ink_total_l,
  );
  return {
    id: row.id || data.id || null,
    machineId: row.machine_id || data.machineId || data.machine_id || null,
    timestamp: row.timestamp
      ? new Date(row.timestamp).toISOString()
      : data.timestamp || null,
    inkTotalL,
    mediaLengthM,
    mediaAreaM2,
    raw: data,
  };
}

function inferMediaLengthM(areaM2, widthM = DEFAULT_MEDIA_WIDTH_M) {
  const area = num(areaM2);
  const width = num(widthM) || DEFAULT_MEDIA_WIDTH_M;
  return area != null && width > 0 ? area / width : null;
}

function summarizeCounterDelta(machineId, startRow, endRow, options = {}) {
  const widthM = num(options.mediaWidthM) || DEFAULT_MEDIA_WIDTH_M;
  const start = readCounterRecord(startRow);
  const end = readCounterRecord(endRow);
  const warnings = [];

  if (!start || !end) {
    warnings.push(
      `Missing ${!start && !end ? 'start and end' : !start ? 'start' : 'end'} Colorado counter for ${machineId}.`,
    );
    return {
      printer: machineId,
      machineId,
      mediaWidthM: widthM,
      rollLengthM: COLORADO_ROLL_LENGTH_M,
      start,
      end,
      deltaMediaLengthM: null,
      deltaMediaAreaM2: null,
      equivalentRolls130m: null,
      deltaInkL: null,
      complete: false,
      warnings,
    };
  }

  const startArea = num(start.mediaAreaM2);
  const endArea = num(end.mediaAreaM2);
  const startLength =
    start.mediaLengthM != null
      ? num(start.mediaLengthM)
      : inferMediaLengthM(startArea, widthM);
  const endLength =
    end.mediaLengthM != null
      ? num(end.mediaLengthM)
      : inferMediaLengthM(endArea, widthM);
  const deltaArea =
    startArea != null && endArea != null ? endArea - startArea : null;
  const deltaLength =
    startLength != null && endLength != null
      ? endLength - startLength
      : deltaArea != null
        ? deltaArea / widthM
        : null;
  const deltaInk =
    start.inkTotalL != null && end.inkTotalL != null
      ? end.inkTotalL - start.inkTotalL
      : null;

  if (deltaArea != null && deltaArea < 0)
    warnings.push(
      `Counter reset detected for ${machineId}: media area decreased.`,
    );
  if (deltaLength != null && deltaLength < 0)
    warnings.push(
      `Counter reset detected for ${machineId}: media length decreased.`,
    );
  if (deltaInk != null && deltaInk < 0)
    warnings.push(
      `Counter reset detected for ${machineId}: ink total decreased.`,
    );

  const complete =
    warnings.length === 0 && deltaArea != null && deltaLength != null;
  return {
    printer: machineId,
    machineId,
    mediaWidthM: widthM,
    rollLengthM: COLORADO_ROLL_LENGTH_M,
    start,
    end,
    deltaMediaLengthM: complete ? round(deltaLength, 3) : null,
    deltaMediaAreaM2: complete ? round(deltaArea, 3) : null,
    equivalentRolls130m: complete
      ? round(deltaLength / COLORADO_ROLL_LENGTH_M, 3)
      : null,
    deltaInkL: deltaInk != null && deltaInk >= 0 ? round(deltaInk, 4) : null,
    complete,
    warnings,
  };
}

function summarizeCounterBreakdown(rowsByMachine, options = {}) {
  const machines = options.machines || ['colorado1', 'colorado2'];
  const printers = machines.map((machineId) => {
    const pair = rowsByMachine[machineId] || {};
    return summarizeCounterDelta(machineId, pair.start, pair.end, options);
  });
  const completePrinters = printers.filter((row) => row.complete);
  const totalArea = completePrinters.reduce(
    (sum, row) => sum + Number(row.deltaMediaAreaM2 || 0),
    0,
  );
  const totalLength = completePrinters.reduce(
    (sum, row) => sum + Number(row.deltaMediaLengthM || 0),
    0,
  );
  return {
    mediaWidthM: num(options.mediaWidthM) || DEFAULT_MEDIA_WIDTH_M,
    rollLengthM: COLORADO_ROLL_LENGTH_M,
    complete: completePrinters.length === printers.length,
    printers,
    total: {
      deltaMediaLengthM: completePrinters.length ? round(totalLength, 3) : null,
      deltaMediaAreaM2: completePrinters.length ? round(totalArea, 3) : null,
      equivalentRolls130m: completePrinters.length
        ? round(totalLength / COLORADO_ROLL_LENGTH_M, 3)
        : null,
    },
    warnings: printers.flatMap((row) => row.warnings || []),
  };
}

module.exports = {
  COLORADO_ROLL_LENGTH_M,
  DEFAULT_MEDIA_WIDTH_M,
  inferMediaLengthM,
  readCounterRecord,
  summarizeCounterBreakdown,
  summarizeCounterDelta,
};
