/* PrintGuard — export/import reporting helpers (loaded before app.js) */
'use strict';

(function attachPrintGuardReporting(global) {
  function createReporting(deps) {
    const {
      APP_VERSION,
      MACHINES,
      Reports,
      S,
      ST_CORECS,
      ST_ITEMS,
      ST_MOVES,
      ST_SETTINGS,
      cfg,
      csvRow,
      dlBlob,
      fetchPrintLogRows,
      fmtExportDateTime,
      fmtFileDT,
      fmtN,
      genId,
      getPrintLogDirectInk,
      getPrintLogEstimateInterval,
      getPrintLogInkDisplay,
      i18n,
      idbClear,
      idbPut,
      loadAll,
      mapPrinterName,
      normalizePrintLogRow,
      printResultLabel,
      setSyncDirtyReason,
      showConfirm,
      showToast,
      StockStore,
      stockDbAdapter,
      enqueueStockAction,
    } = deps;

    function getCurrentMonthExportRange() {
      return Reports.date.getCurrentMonthExportRange(new Date());
    }

    function exportCSVIntervals() {
      const hasCosts = cfg.inkCost > 0 || cfg.mediaCost > 0;
      const rows = Reports.colorado.buildColoradoIntervalRows(
        S.coRecords,
        {
          inkCost: cfg.inkCost,
          mediaCost: cfg.mediaCost,
        },
        MACHINES,
      );
      const csv = Reports.csv.rowsToCsv(rows, [
        {
          key: 'timestamp_from',
          header: 'timestamp_from',
          value: (row) => fmtExportDateTime(row.timestampFrom),
        },
        {
          key: 'timestamp_to',
          header: 'timestamp_to',
          value: (row) => fmtExportDateTime(row.timestampTo),
        },
        {
          key: 'days_elapsed',
          header: 'days_elapsed',
          value: (row) => fmtN(row.daysElapsed, 2),
        },
        { key: 'machine', header: 'machine', value: (row) => row.machine },
        {
          key: 'ink_total_l_to',
          header: 'ink_total_l_to',
          value: (row) => fmtN(row.inkTotalLTo, 3),
        },
        {
          key: 'media_total_m2_to',
          header: 'media_total_m2_to',
          value: (row) => fmtN(row.mediaTotalM2To, 1),
        },
        {
          key: 'ink_used_l',
          header: 'ink_used_l',
          value: (row) => fmtN(row.inkUsedL, 3),
        },
        {
          key: 'media_used_m2',
          header: 'media_used_m2',
          value: (row) => fmtN(row.mediaUsedM2, 1),
        },
        {
          key: 'ink_per_m2',
          header: 'ink_per_m2',
          value: (row) => (row.inkPerM2 !== null ? fmtN(row.inkPerM2, 6) : ''),
        },
        {
          key: 'ink_cost',
          header: 'ink_cost',
          value: (row) => (hasCosts ? fmtN(row.inkCost, 2) : ''),
        },
        {
          key: 'media_cost',
          header: 'media_cost',
          value: (row) => (hasCosts ? fmtN(row.mediaCost, 2) : ''),
        },
        {
          key: 'total_cost',
          header: 'total_cost',
          value: (row) => (hasCosts ? fmtN(row.totalCost, 2) : ''),
        },
        {
          key: 'cost_per_m2',
          header: 'cost_per_m2',
          value: (row) =>
            row.costPerM2 !== null ? fmtN(row.costPerM2, 4) : '',
        },
      ]);
      dlBlob(csv, 'text/csv;charset=utf-8', `co_intervals_${fmtFileDT()}.csv`);
    }

    function exportCSVCurrentMonthCo() {
      const range = getCurrentMonthExportRange();
      const hasCosts = cfg.inkCost > 0 || cfg.mediaCost > 0;
      const rows = Reports.colorado.buildColoradoMonthlySummary(
        S.coRecords,
        {
          inkCost: cfg.inkCost,
          mediaCost: cfg.mediaCost,
        },
        range,
        MACHINES,
      );
      if (!rows.length) {
        showToast(i18n('colorado.export.monthly.none'), 'error');
        return;
      }
      const csv = Reports.csv.rowsToCsv(rows, [
        { key: 'row_type', header: 'row_type', value: (row) => row.rowType },
        {
          key: 'report_month_from',
          header: 'report_month_from',
          value: (row) => row.reportMonthFrom,
        },
        {
          key: 'report_month_to',
          header: 'report_month_to',
          value: (row) => row.reportMonthTo,
        },
        { key: 'machine', header: 'machine', value: (row) => row.machine },
        {
          key: 'timestamp_from',
          header: 'timestamp_from',
          value: (row) => fmtExportDateTime(row.timestampFrom),
        },
        {
          key: 'timestamp_to',
          header: 'timestamp_to',
          value: (row) => fmtExportDateTime(row.timestampTo),
        },
        {
          key: 'days_elapsed',
          header: 'days_elapsed',
          value: (row) =>
            row.daysElapsed == null ? '' : fmtN(row.daysElapsed, 2),
        },
        {
          key: 'ink_total_l_to',
          header: 'ink_total_l_to',
          value: (row) =>
            row.inkTotalLTo == null ? '' : fmtN(row.inkTotalLTo, 3),
        },
        {
          key: 'media_total_m2_to',
          header: 'media_total_m2_to',
          value: (row) =>
            row.mediaTotalM2To == null ? '' : fmtN(row.mediaTotalM2To, 1),
        },
        {
          key: 'ink_used_l',
          header: 'ink_used_l',
          value: (row) => (row.inkUsedL == null ? '' : fmtN(row.inkUsedL, 3)),
        },
        {
          key: 'media_used_m2',
          header: 'media_used_m2',
          value: (row) =>
            row.mediaUsedM2 == null ? '' : fmtN(row.mediaUsedM2, 1),
        },
        {
          key: 'ink_per_m2',
          header: 'ink_per_m2',
          value: (row) => (row.inkPerM2 != null ? fmtN(row.inkPerM2, 6) : ''),
        },
        {
          key: 'ink_cost',
          header: 'ink_cost',
          value: (row) =>
            hasCosts && row.inkCost != null ? fmtN(row.inkCost, 2) : '',
        },
        {
          key: 'media_cost',
          header: 'media_cost',
          value: (row) =>
            hasCosts && row.mediaCost != null ? fmtN(row.mediaCost, 2) : '',
        },
        {
          key: 'total_cost',
          header: 'total_cost',
          value: (row) =>
            hasCosts && row.totalCost != null ? fmtN(row.totalCost, 2) : '',
        },
        {
          key: 'cost_per_m2',
          header: 'cost_per_m2',
          value: (row) => (row.costPerM2 != null ? fmtN(row.costPerM2, 4) : ''),
        },
      ]);
      dlBlob(
        csv,
        'text/csv;charset=utf-8',
        `co_monthly_${range.fileMonth}_${fmtFileDT()}.csv`,
      );
      showToast(i18n('colorado.export.monthly.done'), 'success');
    }

    function exportCSVCombinedLifetimeCo() {
      const rows = Reports.colorado.buildColoradoLifetimeSummary(
        S.coRecords,
        MACHINES,
      );
      if (!rows.length) {
        showToast(i18n('colorado.export.lifetime-combined.none'), 'error');
        return;
      }
      const csv = Reports.csv.rowsToCsv(rows, [
        { key: 'row_type', header: 'row_type', value: (row) => row.rowType },
        {
          key: 'printer_id',
          header: 'printer_id',
          value: (row) => row.printerId,
        },
        {
          key: 'printer_label',
          header: 'printer_label',
          value: (row) => row.printerLabel,
        },
        {
          key: 'lifetime_printed_area_m2',
          header: 'lifetime_printed_area_m2',
          value: () => '',
        },
        {
          key: 'lifetime_media_usage_m2',
          header: 'lifetime_media_usage_m2',
          value: (row) =>
            row.lifetimeMediaUsageM2 == null
              ? ''
              : fmtN(row.lifetimeMediaUsageM2, 1),
        },
        {
          key: 'lifetime_ink_usage_total_l',
          header: 'lifetime_ink_usage_total_l',
          value: (row) =>
            row.lifetimeInkUsageTotalL == null
              ? ''
              : fmtN(row.lifetimeInkUsageTotalL, 3),
        },
        {
          key: 'lifetime_ink_cyan_l',
          header: 'lifetime_ink_cyan_l',
          value: () => '',
        },
        {
          key: 'lifetime_ink_magenta_l',
          header: 'lifetime_ink_magenta_l',
          value: () => '',
        },
        {
          key: 'lifetime_ink_yellow_l',
          header: 'lifetime_ink_yellow_l',
          value: () => '',
        },
        {
          key: 'lifetime_ink_black_l',
          header: 'lifetime_ink_black_l',
          value: () => '',
        },
        {
          key: 'lifetime_ink_white_l',
          header: 'lifetime_ink_white_l',
          value: () => '',
        },
        {
          key: 'last_updated_timestamp',
          header: 'last_updated_timestamp',
          value: (row) => fmtExportDateTime(row.lastUpdatedTimestamp),
        },
      ]);
      dlBlob(
        csv,
        'text/csv;charset=utf-8',
        `co_lifetime_combined_${fmtFileDT()}.csv`,
      );
      showToast(i18n('colorado.export.lifetime-combined.done'), 'success');
    }

    function exportCSVRawCo() {
      const rows = [
        csvRow([
          'id',
          'machine',
          'timestamp',
          'ink_total_l',
          'media_total_m2',
          'note',
          'created_at',
        ]),
      ];
      [...S.coRecords]
        .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp))
        .forEach((r) => {
          rows.push(
            csvRow([
              r.id,
              r.machineId,
              fmtExportDateTime(r.timestamp),
              r.inkTotalLiters,
              r.mediaTotalM2,
              r.note || '',
              fmtExportDateTime(r.createdAt),
            ]),
          );
        });
      dlBlob(
        rows.join('\r\n'),
        'text/csv;charset=utf-8',
        `co_raw_${fmtFileDT()}.csv`,
      );
    }

    function exportCSVStock() {
      const rows = StockStore.replayStockMovements(
        S.items,
        S.movements,
        Reports,
      );
      const csv = Reports.csv.rowsToCsv(rows, [
        {
          key: 'timestamp',
          header: 'timestamp',
          value: (row) => fmtExportDateTime(row.timestamp),
        },
        {
          key: 'article_number',
          header: 'article_number',
          value: (row) => row.articleNumber,
        },
        { key: 'name', header: 'name', value: (row) => row.itemName || '' },
        {
          key: 'movement_type',
          header: 'movement_type',
          value: (row) => row.movType,
        },
        { key: 'qty', header: 'qty', value: (row) => row.qty },
        { key: 'unit', header: 'unit', value: (row) => row.unit || 'ks' },
        {
          key: 'stock_after',
          header: 'stock_after',
          value: (row) => row.stockAfter,
        },
        { key: 'note', header: 'note', value: (row) => row.note || '' },
      ]);
      dlBlob(
        csv,
        'text/csv;charset=utf-8',
        `stock_movements_${fmtFileDT()}.csv`,
      );
    }

    function exportCSVStockLevels() {
      const exportedAt = fmtExportDateTime(new Date().toISOString());
      const rows = Reports.stock.buildStockLevels(
        S.items,
        S.movements,
        { weeksN: cfg.weeksN },
        exportedAt,
      );
      const csv = Reports.csv.rowsToCsv(rows, [
        {
          key: 'exported_at',
          header: 'exported_at',
          value: (row) => row.exportedAt,
        },
        {
          key: 'article_number',
          header: 'article_number',
          value: (row) => row.articleNumber,
        },
        { key: 'name', header: 'name', value: (row) => row.name || '' },
        {
          key: 'category',
          header: 'category',
          value: (row) => row.category || '',
        },
        { key: 'unit', header: 'unit', value: (row) => row.unit || 'ks' },
        {
          key: 'on_hand',
          header: 'on_hand',
          value: (row) => fmtN(row.onHand, 0),
        },
        {
          key: 'avg_weekly_issue',
          header: 'avg_weekly_issue',
          value: (row) =>
            row.avgWeeklyIssue > 0 ? fmtN(row.avgWeeklyIssue, 3) : '0',
        },
        {
          key: 'days_left',
          header: 'days_left',
          value: (row) => (row.daysLeft == null ? '' : row.daysLeft),
        },
        { key: 'status', header: 'status', value: (row) => row.status },
        { key: 'min_qty', header: 'min_qty', value: (row) => row.minQty },
        {
          key: 'lead_time_days',
          header: 'lead_time_days',
          value: (row) => row.leadTimeDays,
        },
        {
          key: 'safety_days',
          header: 'safety_days',
          value: (row) => row.safetyDays,
        },
      ]);
      dlBlob(csv, 'text/csv;charset=utf-8', `stock_levels_${fmtFileDT()}.csv`);
    }

    async function exportCSVPrintLog() {
      try {
        const rows = [
          csvRow([
            'ready_at',
            'printer',
            'job_name',
            'result',
            'media_type',
            'printed_area_m2',
            'ink_total_l',
            'ink_source',
            'ink_cyan_l',
            'ink_magenta_l',
            'ink_yellow_l',
            'ink_black_l',
            'ink_white_l',
            'derived_ink_l_per_m2',
            'estimate_interval_from',
            'estimate_interval_to',
            'duration_sec',
          ]),
        ];
        const allRows = [];
        let offset = 0;
        while (true) {
          const batch = await fetchPrintLogRows({ limit: 200, offset });
          const normalized = Array.isArray(batch.rows)
            ? batch.rows.map(normalizePrintLogRow)
            : [];
          allRows.push(...normalized);
          if (!batch.hasMore || !normalized.length) break;
          offset += normalized.length;
        }
        allRows.forEach((row) => {
          const interval = getPrintLogEstimateInterval(row);
          const ink = getPrintLogInkDisplay(row);
          const direct = getPrintLogDirectInk(row);
          rows.push(
            csvRow([
              fmtExportDateTime(row.readyAt),
              mapPrinterName(row.printerName),
              row.jobName || '',
              printResultLabel(row.result),
              row.mediaType || '',
              Number.isFinite(Number(row.printedAreaM2))
                ? fmtN(row.printedAreaM2, 2)
                : '',
              ink.inkL === null ? '' : fmtN(ink.inkL, 3),
              ink.source === 'direct'
                ? 'direct_print_accounting_rows'
                : ink.source === 'estimated'
                  ? 'derived_from_lifetime_interval_ratio'
                  : '',
              direct.channels?.cyan == null
                ? ''
                : fmtN(direct.channels.cyan, 3),
              direct.channels?.magenta == null
                ? ''
                : fmtN(direct.channels.magenta, 3),
              direct.channels?.yellow == null
                ? ''
                : fmtN(direct.channels.yellow, 3),
              direct.channels?.black == null
                ? ''
                : fmtN(direct.channels.black, 3),
              direct.channels?.white == null
                ? ''
                : fmtN(direct.channels.white, 3),
              ink.source === 'estimated' && ink.estimatedInkPerM2 !== null
                ? fmtN(ink.estimatedInkPerM2, 6)
                : '',
              fmtExportDateTime(interval?.from),
              fmtExportDateTime(interval?.to),
              Number.isFinite(Number(row.durationSec))
                ? fmtN(row.durationSec, 0)
                : '',
            ]),
          );
        });
        dlBlob(
          rows.join('\r\n'),
          'text/csv;charset=utf-8',
          `print_log_estimated_ink_${fmtFileDT()}.csv`,
        );
        showToast(`Export hotov: ${allRows.length} záznamů`, 'success');
      } catch (err) {
        showToast(`Export selhal: ${err.message || err}`, 'error');
      }
    }

    async function exportJSON() {
      const data = {
        exportedAt: new Date().toISOString(),
        appVersion: APP_VERSION,
        items: S.items,
        movements: S.movements,
        coRecords: S.coRecords,
        settings: [
          {
            key: 'config',
            weeksN: cfg.weeksN,
            rollingN: cfg.rollingN,
            inkCost: cfg.inkCost,
            mediaCost: cfg.mediaCost,
            costCurrency: cfg.costCurrency,
            savedAt: new Date().toISOString(),
          },
        ],
      };
      dlBlob(
        JSON.stringify(data, null, 2),
        'application/json',
        `printguard_backup_${fmtFileDT()}.json`,
      );
    }

    async function handleImportJSON(e) {
      const file = e.target.files?.[0];
      if (!file) return;
      e.target.value = '';
      const text = await file.text();
      let data;
      try {
        data = JSON.parse(text);
      } catch {
        showToast('Neplatný JSON soubor', 'error');
        return;
      }
      const importedAt = new Date().toISOString();
      const items = Array.isArray(data.items)
        ? data.items
            .filter((it) => it?.articleNumber)
            .map((it) => ({
              ...it,
              articleNumber: String(it.articleNumber)
                .trim()
                .toUpperCase()
                .replace(/\s+/g, '-'),
              updatedAt: importedAt,
            }))
        : [];
      const movements = Array.isArray(data.movements)
        ? data.movements
            .filter((m) => m?.id && m?.articleNumber)
            .map((m) => ({
              ...m,
              articleNumber: String(m.articleNumber)
                .trim()
                .toUpperCase()
                .replace(/\s+/g, '-'),
              updatedAt: importedAt,
            }))
        : [];
      const coRecords = Array.isArray(data.coRecords)
        ? data.coRecords
            .filter((r) => r?.id && r?.machineId)
            .map((r) => ({
              ...r,
              updatedAt: importedAt,
            }))
        : [];
      const settings = Array.isArray(data.settings)
        ? data.settings.filter((s) => s?.key)
        : [];
      const hasSettingsPayload = Array.isArray(data.settings);
      if (Array.isArray(data.snapshots)) {
        data.snapshots.forEach((snap) => {
          const articleNumber =
            snap.articleNumber || snap.article_number || snap.code;
          if (!articleNumber) return;
          movements.push({
            id: genId('imp'),
            articleNumber: String(articleNumber)
              .trim()
              .toUpperCase()
              .replace(/\s+/g, '-'),
            movType: 'stocktake',
            qty: parseFloat(snap.qty ?? snap.quantity ?? snap.onHand ?? 0),
            timestamp: snap.timestamp || snap.date || new Date().toISOString(),
            note: 'Import StockGuard',
            deviceId: cfg.deviceId,
            updatedAt: importedAt,
          });
        });
      }
      showConfirm(
        `Importovat ${items.length} položek, ${movements.length} pohybů, ${coRecords.length} CO záznamů? Existující data budou přepsána.`,
        async () => {
          const clears = [
            idbClear(ST_ITEMS),
            idbClear(ST_MOVES),
            idbClear(ST_CORECS),
          ];
          if (hasSettingsPayload) clears.push(idbClear(ST_SETTINGS));
          await Promise.all(clears);
          for (const it of items)
            await StockStore.putItem(stockDbAdapter(), it);
          for (const m of movements)
            await StockStore.putMovement(stockDbAdapter(), m);
          if (typeof enqueueStockAction === 'function') {
            for (const it of items) {
              enqueueStockAction({
                entity: 'item',
                action: 'upsert',
                key: it.articleNumber,
                payload: it,
                source: 'import-json:item',
                updatedAt: importedAt,
              });
            }
            for (const m of movements) {
              enqueueStockAction({
                entity: 'movement',
                action: 'upsert',
                key: m.id,
                payload: m,
                source: 'import-json:movement',
                updatedAt: importedAt,
              });
            }
          }
          for (const r of coRecords) await idbPut(ST_CORECS, r);
          for (const s of settings) await idbPut(ST_SETTINGS, s);
          await loadAll();
          setSyncDirtyReason('all');
          showToast(
            `Import hotov: ${items.length} pol., ${movements.length} poh.`,
            'success',
          );
        },
      );
    }

    return {
      exportCSVCombinedLifetimeCo,
      exportCSVCurrentMonthCo,
      exportCSVIntervals,
      exportCSVPrintLog,
      exportCSVRawCo,
      exportCSVStock,
      exportCSVStockLevels,
      exportJSON,
      handleImportJSON,
    };
  }

  global.PrintGuardReporting = { createReporting };
})(window);
