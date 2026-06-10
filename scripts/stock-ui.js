(function attachPrintGuardStockUI(global) {
  'use strict';

  const StockDomain = global.PrintGuardStockDomain;
  if (!StockDomain) throw new Error('Missing PrintGuardStockDomain');

  function statusLabel(status, i18n) {
    return StockDomain.statusLabel(status, i18n);
  }

  function movementLabel(type, i18n) {
    return StockDomain.movementLabel(type, i18n);
  }

  function renderStockOverview(deps) {
    const {
      S,
      computeStock,
      el,
      elSet,
      esc,
      fmtDays,
      fmtN,
      i18n,
      onOpenStockDetail,
      statusLabel,
    } = deps;

    const all = StockDomain.getActiveStockItems(S.items);
    const statusCounts = StockDomain.getStockStatusCounts(
      S.items,
      computeStock,
    );
    elSet('count-ok', statusCounts.ok);
    elSet('count-warn', statusCounts.warn);
    elSet('count-crit', statusCounts.crit);

    const alertCount = statusCounts.warn + statusCounts.crit;
    const alertsLabel = i18n('nav.alerts');
    el('alerts-nav-label').textContent =
      alertCount > 0 ? `${alertsLabel} (${alertCount})` : alertsLabel;

    const filtered = StockDomain.filterStockOverviewItems(S.items, {
      stockFilter: S.stockFilter,
      stockSearch: S.stockSearch,
      computeStock,
    });

    const list = el('stock-list');
    const lblOnHand = i18n('stock.metric.onhand');
    const lblCoverage = i18n('stock.metric.coverage');
    const lblWeekly = i18n('stock.metric.weekly');
    if (!filtered.length) {
      list.innerHTML = `<div class="empty-state">
      <div class="empty-state-icon">📦</div>
      <p>${all.length ? 'Žádné položky neodpovídají filtru.' : 'Žádné položky.\nPřidejte je v záložce Položky nebo importujte JSON.'}</p>
    </div>`;
      return;
    }

    list.innerHTML = filtered
      .map((it) => {
        const m = computeStock(it);
        const dClass =
          m.status === 'crit' ? 'crit-c' : m.status === 'warn' ? 'warn-c' : '';
        const statusLbl = statusLabel(m.status);
        return `<div class="item-card ${m.status}" data-article="${esc(it.articleNumber)}" role="button" tabindex="0">
      <div class="item-card-top">
        <div>
          <div class="item-card-name">${esc(it.name || it.articleNumber)}</div>
          <div class="item-card-code">${esc(it.articleNumber)}${it.category ? ' · ' + esc(it.category) : ''}</div>
        </div>
        <span class="badge ${m.status}">${statusLbl}</span>
      </div>
      <div class="item-card-metrics">
        <div class="metric-mini">
          <span class="metric-mini-val">${fmtN(m.onHand, 0)} <small>${esc(it.unit || 'ks')}</small></span>
          <span class="metric-mini-lbl">${lblOnHand}</span>
        </div>
        <div class="metric-mini">
          <span class="metric-mini-val ${dClass}">${fmtDays(m.daysLeft)}</span>
          <span class="metric-mini-lbl">${lblCoverage}</span>
        </div>
        <div class="metric-mini">
          <span class="metric-mini-val">${m.avgWeekly > 0 ? fmtN(m.avgWeekly, 1) : '—'}</span>
          <span class="metric-mini-lbl">${lblWeekly}</span>
        </div>
      </div>
    </div>`;
      })
      .join('');

    list.querySelectorAll('.item-card').forEach((c) => {
      c.addEventListener('click', () => onOpenStockDetail(c.dataset.article));
      c.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') onOpenStockDetail(c.dataset.article);
      });
    });
  }

  function buildMovementRows(deps) {
    const { esc, fmtDT, fmtN, item, movementLabel, moves } = deps;

    return StockDomain.buildMovementReplayRows(moves)
      .reverse()
      .slice(0, 50)
      .map(({ move: m, after }) => {
        const typeLabel =
          {
            receipt: `↑ ${movementLabel('receipt')}`,
            issue: `↓ ${movementLabel('issue')}`,
            stocktake: `= ${movementLabel('stocktake')}`,
          }[m.movType] || movementLabel(m.movType);
        const typeClass = StockDomain.getMovementTypeClass(m.movType);
        const qtySign = StockDomain.getMovementQuantitySign(m, fmtN);
        return `<tr>
      <td>${fmtDT(m.timestamp)}</td>
      <td class="${typeClass}">${typeLabel}</td>
      <td class="num ${typeClass}">${qtySign} ${esc(item.unit || 'ks')}</td>
      <td class="num">${fmtN(after, 0)} ${esc(item.unit || 'ks')}</td>
      <td class="note-td">${esc(m.note || '—')}</td>
      <td><button class="btn-del" data-id="${esc(m.id)}" title="Smazat">✕</button></td>
    </tr>`;
      })
      .join('');
  }

  function buildStockHistoryTable(deps) {
    const { esc, fmtDT, fmtN, i18n, item, movementLabel, moves } = deps;

    if (!moves.length) {
      return '<div class="empty-state" style="padding:18px 0"><p>Žádné pohyby — history není k dispozici.</p></div>';
    }

    const typeLabel = {
      receipt: `↑ ${movementLabel('receipt')}`,
      issue: `↓ ${movementLabel('issue')}`,
      stocktake: `= ${movementLabel('stocktake')}`,
    };
    const html = StockDomain.buildStockHistoryRows(moves)
      .reverse()
      .slice(0, 100)
      .map(({ move: m, after, delta }) => {
        const sign = StockDomain.formatStockHistoryDelta(delta, m, fmtN);
        const dClass = StockDomain.getStockHistoryDeltaClass(delta);
        return `<tr>
      <td>${fmtDT(m.timestamp)}</td>
      <td class="${StockDomain.getMovementTypeClass(m.movType)}">${typeLabel[m.movType] || m.movType}</td>
      <td class="num ${dClass}">${sign} ${esc(item.unit || 'ks')}</td>
      <td class="num"><strong>${fmtN(after, 0)}</strong> ${esc(item.unit || 'ks')}</td>
      <td class="note-td">${esc(m.note || '—')}</td>
    </tr>`;
      })
      .join('');
    return `<table class="data-table">
    <thead><tr><th>${i18n('table.date')}</th><th>${i18n('table.type')}</th><th>${i18n('table.change')}</th><th>${i18n('table.after')}</th><th>${i18n('table.note')}</th></tr></thead>
    <tbody>${html}</tbody>
  </table>`;
  }

  function renderAlerts(deps) {
    const {
      S,
      computeStock,
      el,
      esc,
      fmtDays,
      fmtN,
      i18n,
      onOpenStockDetail,
      statusLabel,
    } = deps;

    const alertItems = StockDomain.getAlertStockItems(S.items, computeStock);

    const list = el('alerts-list');
    const lblOnHand = i18n('stock.metric.onhand');
    const lblCoverage = i18n('stock.metric.coverage');
    if (!alertItems.length) {
      list.innerHTML = `<div class="empty-state"><div class="empty-state-icon">✓</div><p>${i18n('msg.no-alerts')}</p></div>`;
      return;
    }
    list.innerHTML = alertItems
      .map((it) => {
        const m = computeStock(it);
        const lbl = statusLabel(m.status);
        return `<div class="item-card ${m.status}" data-article="${esc(it.articleNumber)}" role="button" tabindex="0">
      <div class="item-card-top">
        <div>
          <div class="item-card-name">${esc(it.name || it.articleNumber)}</div>
          <div class="item-card-code">${esc(it.articleNumber)}</div>
        </div>
        <span class="badge ${m.status}">${lbl}</span>
      </div>
      <div class="item-card-metrics">
        <div class="metric-mini">
          <span class="metric-mini-val">${fmtN(m.onHand, 0)} <small>${esc(it.unit || 'ks')}</small></span>
          <span class="metric-mini-lbl">${lblOnHand}</span>
        </div>
        <div class="metric-mini">
          <span class="metric-mini-val ${m.status === 'crit' ? 'crit-c' : 'warn-c'}">${fmtDays(m.daysLeft)}</span>
          <span class="metric-mini-lbl">${lblCoverage}</span>
        </div>
        <div class="metric-mini">
          <span class="metric-mini-val">${it.leadTimeDays || '—'}</span>
          <span class="metric-mini-lbl">Dod. lhůta</span>
        </div>
      </div>
    </div>`;
      })
      .join('');
    list.querySelectorAll('.item-card').forEach((c) => {
      c.addEventListener('click', () => onOpenStockDetail(c.dataset.article));
    });
  }

  global.PrintGuardStockUI = {
    buildMovementRows,
    buildStockHistoryTable,
    movementLabel,
    renderAlerts,
    renderStockOverview,
    statusLabel,
  };
})(window);
