(function attachPrintGuardStockLog(global) {
  'use strict';

  function createStockLog(deps) {
    const {
      Reports,
      S,
      StockStore,
      deleteMovementAdmin,
      dlBlob,
      el,
      esc,
      fmtDT,
      fmtExportDateTime,
      fmtFileDT,
      fmtN,
      i18n,
      movementLabel,
      openStockDetail,
    } = deps;

    function renderStockLog() {
      const filtered = Reports.stock.buildStockLogRows(S.items, S.movements, {
        movType: S.logFilter,
        search: S.logSearch,
        from: S.logDateFrom,
        to: S.logDateTo,
      });

      const wrap = el('stock-log-wrap');
      if (!filtered.length) {
        wrap.innerHTML = '<div class="empty-state"><div class="empty-state-icon">📋</div><p>Žádné pohyby neodpovídají filtru.</p></div>';
        return;
      }

      const typeLabel = {
        receipt: `↑ ${movementLabel('receipt')}`,
        issue: `↓ ${movementLabel('issue')}`,
        stocktake: `= ${movementLabel('stocktake')}`,
      };
      const typeClass = { receipt: 'receipt-c', issue: 'issue-c', stocktake: 'stocktake-c' };

      const rows = [...filtered].reverse().map(m => {
        const sign = m.movType === 'issue'
          ? `−${fmtN(m.qty, 0)}`
          : m.movType === 'receipt'
            ? `+${fmtN(m.qty, 0)}`
            : `=${fmtN(m.qty, 0)}`;
        const deltaClass = m.movType === 'receipt' ? 'receipt-c' : m.movType === 'issue' ? 'issue-c' : 'stocktake-c';
        return `<tr>
      <td>${fmtDT(m.timestamp)}</td>
      <td class="log-item-name" data-article="${esc(m.articleNumber)}" style="cursor:pointer">${esc(m.itemName)}<br><span style="font-size:.6rem;color:var(--text-faint);letter-spacing:.05em">${esc(m.articleNumber)}</span></td>
      <td class="${typeClass[m.movType] || ''}">${typeLabel[m.movType] || m.movType}</td>
      <td class="num ${deltaClass}">${sign} <small>${esc(m.unit)}</small></td>
      <td class="num"><strong>${fmtN(m.stockAfter, 0)}</strong> <small>${esc(m.unit)}</small></td>
      <td class="note-td">${esc(m.note || '—')}</td>
      <td><button class="btn-del admin-only" data-id="${esc(m.id)}" title="Smazat (jen admin)">✕</button></td>
    </tr>`;
      }).join('');

      wrap.innerHTML = `<table class="data-table">
    <thead><tr>
      <th>${i18n('table.date')}</th><th>${i18n('table.item')}</th><th>${i18n('table.type')}</th><th>${i18n('table.change')}</th><th>${i18n('table.after')}</th><th>${i18n('table.note')}</th><th></th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table>`;

      wrap.querySelectorAll('.log-item-name[data-article]').forEach(td =>
        td.addEventListener('click', () => openStockDetail(td.dataset.article))
      );
      wrap.querySelectorAll('.btn-del[data-id]').forEach(btn =>
        btn.addEventListener('click', () => deleteMovementAdmin(btn.dataset.id))
      );
    }

    function exportCSVStockLog() {
      const rows = StockStore.replayStockMovements(S.items, S.movements, Reports);
      const csv = Reports.csv.rowsToCsv(rows, [
        { key: 'timestamp', header: 'timestamp', value: row => fmtExportDateTime(row.timestamp) },
        { key: 'article_number', header: 'article_number', value: row => row.articleNumber },
        { key: 'name', header: 'name', value: row => row.itemName || '' },
        { key: 'category', header: 'category', value: row => row.category || '' },
        { key: 'unit', header: 'unit', value: row => row.unit || 'ks' },
        { key: 'movement_type', header: 'movement_type', value: row => row.movType },
        { key: 'qty', header: 'qty', value: row => row.qty },
        { key: 'stock_after', header: 'stock_after', value: row => row.stockAfter },
        { key: 'note', header: 'note', value: row => row.note || '' },
      ]);
      dlBlob(csv, 'text/csv;charset=utf-8', `pohyby_skladu_${fmtFileDT()}.csv`);
    }

    return {
      exportCSVStockLog,
      renderStockLog,
    };
  }

  global.PrintGuardStockLog = {
    createStockLog,
  };
})(window);
