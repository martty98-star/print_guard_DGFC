#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const { rowsToCsv } = require('../reports/csv.js');
const { buildColoradoMonthlySummary, DEFAULT_MACHINES } = require('../reports/colorado.js');

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

function fail(message) {
  console.error(message);
  process.exit(1);
}

function pad(num) {
  return String(num).padStart(2, '0');
}

function getRangeForMonth(monthArg) {
  const value = String(monthArg || '').trim();
  if (!/^\d{4}-\d{2}$/.test(value)) {
    fail('Invalid --month format. Use YYYY-MM.');
  }
  const [yearRaw, monthRaw] = value.split('-');
  const year = Number(yearRaw);
  const month = Number(monthRaw);
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    fail('Invalid --month value.');
  }

  const from = new Date(year, month - 1, 1, 0, 0, 0, 0);
  const to = new Date(year, month, 0, 23, 59, 59, 999);

  return {
    fromMs: from.getTime(),
    toMs: to.getTime(),
    fromIso: from.toISOString(),
    toIso: to.toISOString(),
    fromDate: `${yearRaw}-${monthRaw}-01`,
    toDate: `${yearRaw}-${monthRaw}-${pad(to.getDate())}`,
    fileMonth: `${yearRaw}-${monthRaw}`,
  };
}

function getCurrentMonthRange() {
  const now = new Date();
  return getRangeForMonth(`${now.getFullYear()}-${pad(now.getMonth() + 1)}`);
}

function fmtFileDT() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}`;
}

function fmtNumber(value, decimals) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '';
  return Number(value).toFixed(decimals);
}

function fmtExportDateTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return String(iso);
  return d.toLocaleString('cs-CZ', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function loadInputJson(inputPath) {
  const resolved = path.resolve(process.cwd(), inputPath);
  if (!fs.existsSync(resolved)) {
    fail(`Input file not found: ${resolved}`);
  }
  const raw = fs.readFileSync(resolved, 'utf8');
  try {
    return JSON.parse(raw);
  } catch (err) {
    fail(`Invalid JSON in input file: ${err.message}`);
  }
}

function getConfigFromPayload(payload, cliArgs) {
  const settings = Array.isArray(payload.settings)
    ? payload.settings.find(entry => entry && entry.key === 'config') || {}
    : {};

  return {
    inkCost: cliArgs['ink-cost'] != null ? Number(cliArgs['ink-cost']) : Number(settings.inkCost || 0),
    mediaCost: cliArgs['media-cost'] != null ? Number(cliArgs['media-cost']) : Number(settings.mediaCost || 0),
    costCurrency: String(cliArgs['cost-currency'] || settings.costCurrency || 'CZK').toUpperCase(),
  };
}

function buildCsv(rows, hasCosts) {
  return rowsToCsv(rows, [
    { key: 'row_type', header: 'row_type', value: row => row.rowType },
    { key: 'report_month_from', header: 'report_month_from', value: row => row.reportMonthFrom },
    { key: 'report_month_to', header: 'report_month_to', value: row => row.reportMonthTo },
    { key: 'machine', header: 'machine', value: row => row.machine },
    { key: 'timestamp_from', header: 'timestamp_from', value: row => fmtExportDateTime(row.timestampFrom) },
    { key: 'timestamp_to', header: 'timestamp_to', value: row => fmtExportDateTime(row.timestampTo) },
    { key: 'days_elapsed', header: 'days_elapsed', value: row => row.daysElapsed == null ? '' : fmtNumber(row.daysElapsed, 2) },
    { key: 'ink_total_l_to', header: 'ink_total_l_to', value: row => row.inkTotalLTo == null ? '' : fmtNumber(row.inkTotalLTo, 3) },
    { key: 'media_total_m2_to', header: 'media_total_m2_to', value: row => row.mediaTotalM2To == null ? '' : fmtNumber(row.mediaTotalM2To, 1) },
    { key: 'ink_used_l', header: 'ink_used_l', value: row => row.inkUsedL == null ? '' : fmtNumber(row.inkUsedL, 3) },
    { key: 'media_used_m2', header: 'media_used_m2', value: row => row.mediaUsedM2 == null ? '' : fmtNumber(row.mediaUsedM2, 1) },
    { key: 'ink_per_m2', header: 'ink_per_m2', value: row => row.inkPerM2 == null ? '' : fmtNumber(row.inkPerM2, 6) },
    { key: 'ink_cost', header: 'ink_cost', value: row => hasCosts && row.inkCost != null ? fmtNumber(row.inkCost, 2) : '' },
    { key: 'media_cost', header: 'media_cost', value: row => hasCosts && row.mediaCost != null ? fmtNumber(row.mediaCost, 2) : '' },
    { key: 'total_cost', header: 'total_cost', value: row => hasCosts && row.totalCost != null ? fmtNumber(row.totalCost, 2) : '' },
    { key: 'cost_per_m2', header: 'cost_per_m2', value: row => row.costPerM2 == null ? '' : fmtNumber(row.costPerM2, 4) },
  ]);
}

function resolveOutputPath(outputArg, month) {
  if (outputArg) {
    return path.resolve(process.cwd(), outputArg);
  }
  return path.resolve(process.cwd(), `co_monthly_${month}_${fmtFileDT()}.csv`);
}

function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!args.input) {
    fail('Usage: node scripts/export-colorado-monthly.js --input <backup.json> [--output <file.csv>] [--month YYYY-MM] [--ink-cost 0] [--media-cost 0] [--cost-currency SEK]');
  }

  const payload = loadInputJson(args.input);
  const coRecords = Array.isArray(payload.coRecords) ? payload.coRecords.filter(record => record?.id && record?.machineId) : [];
  if (!coRecords.length) {
    fail('No Colorado records found in input JSON.');
  }

  const range = args.month ? getRangeForMonth(args.month) : getCurrentMonthRange();
  const config = getConfigFromPayload(payload, args);
  const rows = buildColoradoMonthlySummary(coRecords, config, range, DEFAULT_MACHINES);

  if (!rows.length) {
    fail(`No Colorado intervals found for month ${range.fileMonth}.`);
  }

  const csv = buildCsv(rows, config.inkCost > 0 || config.mediaCost > 0);
  const outputPath = resolveOutputPath(args.output, range.fileMonth);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `\uFEFF${csv}`, 'utf8');

  console.log(`Colorado monthly CSV created: ${outputPath}`);
  console.log(`Month: ${range.fileMonth}`);
  console.log(`Rows: ${rows.length}`);
  console.log(`Cost currency: ${config.costCurrency}`);
}

main();
