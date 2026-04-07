(function (global) {
  const root = global.PrintGuardReports || (global.PrintGuardReports = {});

  function csvEsc(value) {
    const str = String(value === null || value === undefined ? '' : value);
    if (str.includes('"') || str.includes(',') || str.includes('\n') || str.includes('\r')) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  }

  function csvRow(values) {
    return values.map(csvEsc).join(',');
  }

  function rowsToCsv(rows, columns) {
    const header = csvRow(columns.map(col => col.header));
    const body = rows.map(row => csvRow(columns.map(col => col.value(row))));
    return [header, ...body].join('\r\n');
  }

  const api = {
    csvEsc,
    csvRow,
    rowsToCsv,
  };

  root.csv = api;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
