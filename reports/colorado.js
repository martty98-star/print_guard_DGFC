(function (global) {
  const root = global.PrintGuardReports || (global.PrintGuardReports = {});

  const DEFAULT_MACHINES = [
    { id: 'colorado1', label: 'Colorado 1' },
    { id: 'colorado2', label: 'Colorado 2' },
  ];

  function toNumber(value) {
    const num = Number(value);
    return Number.isFinite(num) ? num : 0;
  }

  function sortByTimestampAsc(records) {
    return [...records].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
  }

  function getColoradoRecords(records, machineId) {
    return sortByTimestampAsc((records || []).filter(record => record.machineId === machineId));
  }

  function buildColoradoIntervals(records, config) {
    const cfg = config || {};
    const sorted = sortByTimestampAsc(records || []);
    return sorted.slice(1).map((current, index) => {
      const previous = sorted[index];
      const ms = new Date(current.timestamp) - new Date(previous.timestamp);
      const days = Math.max(ms / 86400000, 0.0001);
      const inkUsed = Math.max(0, toNumber(current.inkTotalLiters) - toNumber(previous.inkTotalLiters));
      const mediaUsed = Math.max(0, toNumber(current.mediaTotalM2) - toNumber(previous.mediaTotalM2));
      const inkPerM2 = mediaUsed > 0 ? inkUsed / mediaUsed : null;
      const inkCost = inkUsed * toNumber(cfg.inkCost);
      const mediaCost = mediaUsed * toNumber(cfg.mediaCost);
      const totalCost = inkCost + mediaCost;
      const costPerM2 = mediaUsed > 0 ? totalCost / mediaUsed : null;

      return {
        from: previous.timestamp,
        to: current.timestamp,
        days,
        machineId: current.machineId,
        inkTotalTo: toNumber(current.inkTotalLiters),
        mediaTotalTo: toNumber(current.mediaTotalM2),
        inkUsed,
        mediaUsed,
        inkPerDay: inkUsed / days,
        mediaPerDay: mediaUsed / days,
        inkPerM2,
        inkCost,
        mediaCost,
        totalCost,
        costPerM2,
        recordId: current.id,
      };
    });
  }

  function buildColoradoStats(records, config) {
    const cfg = config || {};
    const intervals = buildColoradoIntervals(records, cfg);
    const rollingN = Math.max(1, Number(cfg.rollingN) || 1);
    const recent = intervals.slice(-rollingN);
    if (!recent.length) return null;

    const avg = values => values.reduce((sum, value) => sum + value, 0) / values.length;
    const avgInkDay = avg(recent.map(row => row.inkPerDay));
    const avgMediaDay = avg(recent.map(row => row.mediaPerDay));
    const validInkPerM2 = recent.filter(row => row.inkPerM2 !== null);
    const avgInkPM2 = validInkPerM2.length ? avg(validInkPerM2.map(row => row.inkPerM2)) : null;
    const hasCosts = toNumber(cfg.inkCost) > 0 || toNumber(cfg.mediaCost) > 0;
    const validCosts = recent.filter(row => row.costPerM2 !== null);
    const avgCostPM2 = hasCosts && validCosts.length ? avg(validCosts.map(row => row.costPerM2)) : null;
    const sorted = sortByTimestampAsc(records || []);

    return {
      machineId: sorted[sorted.length - 1]?.machineId || null,
      recordCount: sorted.length,
      intervalCount: intervals.length,
      avgInkDay,
      avgInkMonth: avgInkDay * 30,
      avgMediaDay,
      avgMediaMonth: avgMediaDay * 30,
      avgInkPM2,
      avgCostPM2,
      hasCosts,
      last: sorted[sorted.length - 1] || null,
    };
  }

  function buildColoradoIntervalRows(records, config, machines) {
    const machineDefs = machines || DEFAULT_MACHINES;
    return machineDefs.flatMap(machine =>
      buildColoradoIntervals(getColoradoRecords(records, machine.id), config).map(interval => ({
        timestampFrom: interval.from,
        timestampTo: interval.to,
        daysElapsed: interval.days,
        machine: machine.id,
        inkTotalLTo: interval.inkTotalTo,
        mediaTotalM2To: interval.mediaTotalTo,
        inkUsedL: interval.inkUsed,
        mediaUsedM2: interval.mediaUsed,
        inkPerM2: interval.inkPerM2,
        inkCost: interval.inkCost,
        mediaCost: interval.mediaCost,
        totalCost: interval.totalCost,
        costPerM2: interval.costPerM2,
      }))
    );
  }

  function buildColoradoMonthlySummary(records, config, range, machines) {
    const machineDefs = machines || DEFAULT_MACHINES;
    const rows = [];
    const totals = [];

    machineDefs.forEach(machine => {
      const intervals = buildColoradoIntervals(getColoradoRecords(records, machine.id), config)
        .filter(interval => {
          const toMs = new Date(interval.to).getTime();
          return Number.isFinite(toMs) && toMs >= range.fromMs && toMs <= range.toMs;
        });

      if (!intervals.length) return;

      intervals.forEach(interval => {
        rows.push({
          rowType: 'interval',
          reportMonthFrom: range.fromDate,
          reportMonthTo: range.toDate,
          machine: machine.id,
          timestampFrom: interval.from,
          timestampTo: interval.to,
          daysElapsed: interval.days,
          inkTotalLTo: interval.inkTotalTo,
          mediaTotalM2To: interval.mediaTotalTo,
          inkUsedL: interval.inkUsed,
          mediaUsedM2: interval.mediaUsed,
          inkPerM2: interval.inkPerM2,
          inkCost: interval.inkCost,
          mediaCost: interval.mediaCost,
          totalCost: interval.totalCost,
          costPerM2: interval.costPerM2,
        });
      });

      const inkUsed = intervals.reduce((sum, interval) => sum + interval.inkUsed, 0);
      const mediaUsed = intervals.reduce((sum, interval) => sum + interval.mediaUsed, 0);
      const inkCost = intervals.reduce((sum, interval) => sum + interval.inkCost, 0);
      const mediaCost = intervals.reduce((sum, interval) => sum + interval.mediaCost, 0);
      const totalCost = inkCost + mediaCost;

      totals.push({ inkUsed, mediaUsed, inkCost, mediaCost, totalCost });
      rows.push({
        rowType: 'machine_total',
        reportMonthFrom: range.fromDate,
        reportMonthTo: range.toDate,
        machine: machine.id,
        inkUsedL: inkUsed,
        mediaUsedM2: mediaUsed,
        inkPerM2: mediaUsed > 0 ? inkUsed / mediaUsed : null,
        inkCost,
        mediaCost,
        totalCost,
        costPerM2: mediaUsed > 0 ? totalCost / mediaUsed : null,
      });
    });

    if (!totals.length) return [];

    const totalInkUsed = totals.reduce((sum, record) => sum + record.inkUsed, 0);
    const totalMediaUsed = totals.reduce((sum, record) => sum + record.mediaUsed, 0);
    const totalInkCost = totals.reduce((sum, record) => sum + record.inkCost, 0);
    const totalMediaCost = totals.reduce((sum, record) => sum + record.mediaCost, 0);
    const totalCost = totalInkCost + totalMediaCost;

    rows.push({
      rowType: 'month_total',
      reportMonthFrom: range.fromDate,
      reportMonthTo: range.toDate,
      machine: 'all',
      inkUsedL: totalInkUsed,
      mediaUsedM2: totalMediaUsed,
      inkPerM2: totalMediaUsed > 0 ? totalInkUsed / totalMediaUsed : null,
      inkCost: totalInkCost,
      mediaCost: totalMediaCost,
      totalCost,
      costPerM2: totalMediaUsed > 0 ? totalCost / totalMediaUsed : null,
    });

    return rows;
  }

  function getLatestColoradoRecord(records, machineId) {
    const machineRecords = getColoradoRecords(records, machineId);
    return machineRecords.length ? machineRecords[machineRecords.length - 1] : null;
  }

  function buildColoradoLifetimeSummary(records, machines) {
    const machineDefs = machines || DEFAULT_MACHINES;
    const rows = machineDefs.map(machine => {
      const latest = getLatestColoradoRecord(records, machine.id);
      if (!latest) return null;
      return {
        rowType: 'printer',
        printerId: machine.id,
        printerLabel: machine.label,
        lifetimePrintedAreaM2: null,
        lifetimeMediaUsageM2: toNumber(latest.mediaTotalM2),
        lifetimeInkUsageTotalL: toNumber(latest.inkTotalLiters),
        lifetimeInkCyanL: null,
        lifetimeInkMagentaL: null,
        lifetimeInkYellowL: null,
        lifetimeInkBlackL: null,
        lifetimeInkWhiteL: null,
        lastUpdatedTimestamp: latest.timestamp,
      };
    }).filter(Boolean);

    if (!rows.length) return [];

    const combinedInk = rows.reduce((sum, row) => sum + row.lifetimeInkUsageTotalL, 0);
    const combinedMedia = rows.reduce((sum, row) => sum + row.lifetimeMediaUsageM2, 0);
    const combinedLastUpdated = rows.reduce((latest, row) => {
      const currentMs = new Date(row.lastUpdatedTimestamp).getTime();
      if (!Number.isFinite(currentMs)) return latest;
      if (!latest || currentMs > latest.ms) return { ms: currentMs, iso: row.lastUpdatedTimestamp };
      return latest;
    }, null);

    return [
      ...rows,
      {
        rowType: 'combined_total',
        printerId: 'combined',
        printerLabel: 'Colorado 1 + Colorado 2',
        lifetimePrintedAreaM2: null,
        lifetimeMediaUsageM2: combinedMedia,
        lifetimeInkUsageTotalL: combinedInk,
        lifetimeInkCyanL: null,
        lifetimeInkMagentaL: null,
        lifetimeInkYellowL: null,
        lifetimeInkBlackL: null,
        lifetimeInkWhiteL: null,
        lastUpdatedTimestamp: combinedLastUpdated ? combinedLastUpdated.iso : null,
      },
    ];
  }

  const api = {
    DEFAULT_MACHINES,
    getColoradoRecords,
    getLatestColoradoRecord,
    buildColoradoIntervals,
    buildColoradoStats,
    buildColoradoIntervalRows,
    buildColoradoMonthlySummary,
    buildColoradoLifetimeSummary,
  };

  root.colorado = api;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
