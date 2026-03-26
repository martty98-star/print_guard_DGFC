export function createStockModule(core) {
  const {
    cfg,
    S,
    ST_ITEMS,
    ST_MOVES,
    idbPut,
    idbDelete,
    genId,
    navigate,
    isAdmin,
    el,
    elSet,
    esc,
    fmtN,
    fmtDays,
    fmtDT,
    showToast,
    showConfirm,
    dateRangeFilter,
    csvRow,
    fmtFileDT,
    dlBlob,
  } = core;

  function getMovements(articleNumber) {
    return S.movements.filter(m => m.articleNumber === articleNumber);
  }

  function computeStock(item) {
    const moves = getMovements(item.articleNumber);

    let baseline = 0;
    let baselineIdx = -1;
    for (let i = moves.length - 1; i >= 0; i--) {
      if (moves[i].movType === 'stocktake') {
        baseline = moves[i].qty;
        baselineIdx = i;
        break;
      }
    }

    let onHand = baseline;
    const relevantMoves = baselineIdx >= 0 ? moves.slice(baselineIdx + 1) : moves;
    for (const m of relevantMoves) {
      if (m.movType === 'receipt') onHand += m.qty;
      if (m.movType === 'issue') onHand -= m.qty;
      if (m.movType === 'stocktake') onHand = m.qty;
    }
    onHand = Math.max(0, onHand);

    const N = cfg.weeksN;
    const cutoff = new Date(Date.now() - N * 7 * 86400 * 1000);
    const recentIssues = S.movements.filter(m =>
      m.articleNumber === item.articleNumber &&
      m.movType === 'issue' &&
      new Date(m.timestamp) >= cutoff
    );
    const totalIssued = recentIssues.reduce((s, m) => s + m.qty, 0);
    const avgWeekly = totalIssued / N;
    const daysLeft = avgWeekly > 0 ? (onHand / avgWeekly) * 7 : (onHand > 0 ? 999 : 0);

    const leadTime = item.leadTimeDays || 0;
    const safety = item.safetyDays || 7;
    const minQty = item.minQty || 0;

    let status;
    if (minQty > 0) {
      status = onHand <= 0 ? 'crit' : onHand <= minQty ? 'crit' : onHand <= minQty * 2 ? 'warn' : 'ok';
    } else {
      status = onHand <= 0 || daysLeft <= 7 ? 'crit'
        : daysLeft <= (leadTime + safety) ? 'warn'
        : 'ok';
    }

    return { onHand, avgWeekly, daysLeft: Math.round(daysLeft), status, moveCount: moves.length };
  }

  function renderStockOverview() {
    const q = S.stockSearch.toLowerCase();
    const all = S.items.filter(it => it.isActive !== false);

    let ok = 0, warn = 0, crit = 0;
    all.forEach(it => {
      const s = computeStock(it).status;
      if (s === 'ok') ok++;
      else if (s === 'warn') warn++;
      else crit++;
    });
    elSet('count-ok', ok);
    elSet('count-warn', warn);
    elSet('count-crit', crit);

    const alertCount = warn + crit;
    el('alerts-nav-label').textContent = alertCount > 0 ? `Upozornení (${alertCount})` : 'Upozornení';

    const filtered = all.filter(it => {
      const m = computeStock(it);
      const matchStatus = S.stockFilter === 'all' || m.status === S.stockFilter;
      const matchSearch = !q
        || (it.name || '').toLowerCase().includes(q)
        || (it.articleNumber || '').toLowerCase().includes(q)
        || (it.category || '').toLowerCase().includes(q);
      return matchStatus && matchSearch;
    });

    const list = el('stock-list');
    if (!filtered.length) {
      list.innerHTML = `<div class="empty-state">
        <div class="empty-state-icon">??</div>
        <p>${all.length ? 'Žádné položky neodpovídají filtru.' : 'Žádné položky.\nPridejte je v záložce Položky nebo importujte JSON.'}</p>
      </div>`;
      return;
    }

    list.innerHTML = filtered.map(it => {
      const m = computeStock(it);
      const dClass = m.status === 'crit' ? 'crit-c' : m.status === 'warn' ? 'warn-c' : '';
      const statusLbl = { ok: 'OK', warn: 'Varování', crit: 'Kritické' }[m.status];
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
            <span class="metric-mini-lbl">Na sklade</span>
          </div>
          <div class="metric-mini">
            <span class="metric-mini-val ${dClass}">${fmtDays(m.daysLeft)}</span>
            <span class="metric-mini-lbl">Zásoba na</span>
          </div>
          <div class="metric-mini">
            <span class="metric-mini-val">${m.avgWeekly > 0 ? fmtN(m.avgWeekly, 1) : '—'}</span>
            <span class="metric-mini-lbl">Týd. spotreba</span>
          </div>
        </div>
      </div>`;
    }).join('');

    list.querySelectorAll('.item-card').forEach(c => {
      c.addEventListener('click', () => openStockDetail(c.dataset.article));
      c.addEventListener('keydown', e => { if (e.key === 'Enter') openStockDetail(c.dataset.article); });
    });
  }

  function openStockDetail(articleNumber) {
    const item = S.items.find(it => it.articleNumber === articleNumber);
    if (!item) return;
    S.detailArticle = articleNumber;
    el('detail-title').textContent = item.name || articleNumber;

    const m = computeStock(item);
    const moves = getMovements(articleNumber);
    const statusLbl = { ok: 'OK', warn: 'Varování', crit: 'Kritické' }[m.status];

    el('detail-content').innerHTML = `
      <div class="detail-hero">
        <span class="badge ${m.status}" style="display:inline-block;margin-bottom:12px">${statusLbl}</span>
        <div>
          <span class="detail-big">${fmtN(m.onHand, 0)}</span>
          <span class="detail-unit">${esc(item.unit || 'ks')}</span>
        </div>
        <div class="detail-metrics-grid">
          <div class="dm-item"><span class="dm-val">${fmtDays(m.daysLeft)}</span><span class="dm-lbl">Zásoba na</span></div>
          <div class="dm-item"><span class="dm-val">${m.avgWeekly > 0 ? fmtN(m.avgWeekly, 1) : '—'}</span><span class="dm-lbl">Týd. spotreba</span></div>
          <div class="dm-item"><span class="dm-val">${item.leadTimeDays || '—'}</span><span class="dm-lbl">Dod. lhuta (dny)</span></div>
        </div>
      </div>

      <div class="detail-section">
        <div class="detail-section-title">Parametry položky</div>
        <div class="param-row"><span>Císlo artiklu</span><code>${esc(articleNumber)}</code></div>
        ${item.category ? `<div class="param-row"><span>Kategorie</span><span>${esc(item.category)}</span></div>` : ''}
        ${item.supplier ? `<div class="param-row"><span>Dodavatel</span><span>${esc(item.supplier)}</span></div>` : ''}
        ${item.MOQ ? `<div class="param-row"><span>MOQ</span><span>${item.MOQ}</span></div>` : ''}
        ${item.leadTimeDays ? `<div class="param-row"><span>Dodací lhuta</span><span>${item.leadTimeDays} dní</span></div>` : ''}
        ${item.safetyDays ? `<div class="param-row"><span>Bezp. zásoba</span><span>${item.safetyDays} dní</span></div>` : ''}
        ${item.minQty ? `<div class="param-row"><span>Min. množství</span><span>${item.minQty} ${esc(item.unit || 'ks')}</span></div>` : ''}
        ${item.orderUrl ? `<div class="param-row admin-only"><span>Odkaz na objednávku</span><a href="${esc(item.orderUrl)}" target="_blank" rel="noopener" class="order-link">?? Objednat</a></div>` : ''}
      </div>

      <div class="detail-section">
        <div class="detail-section-head">
          <div class="detail-tabs">
            <button class="detail-tab active" data-tab="movements">Pohyby</button>
            <button class="detail-tab" data-tab="history">Stav skladu</button>
          </div>
          <button class="btn-sm" id="detail-add-mov-btn">+ Nový pohyb</button>
        </div>
        <div class="detail-tab-pane table-wrap" data-pane="movements" style="margin-top:10px">
          ${moves.length ? `<table class="data-table">
            <thead><tr><th>Datum</th><th>Typ</th><th>Množství</th><th>Stav po</th><th>Poznámka</th><th></th></tr></thead>
            <tbody>${buildMovementRows(item, moves)}</tbody>
          </table>` : '<div class="empty-state" style="padding:18px 0"><p>Žádné pohyby. Pridejte príjem nebo inventuru.</p></div>'}
        </div>
        <div class="detail-tab-pane table-wrap hidden" data-pane="history" style="margin-top:10px">
          ${buildStockHistoryTable(item, moves)}
        </div>
      </div>`;

    el('detail-add-mov-btn')?.addEventListener('click', () => {
      S.movItem = item;
      prefillMovItem(item);
      navigate('stock-movement');
    });

    const dc = el('detail-content');
    dc.querySelectorAll('.detail-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        dc.querySelectorAll('.detail-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        const which = tab.dataset.tab;
        dc.querySelector('.detail-tab-pane[data-pane="movements"]')?.classList.toggle('hidden', which !== 'movements');
        dc.querySelector('.detail-tab-pane[data-pane="history"]')?.classList.toggle('hidden', which !== 'history');
      });
    });

    el('detail-content').querySelectorAll('.btn-del').forEach(btn => {
      btn.addEventListener('click', () => deleteMovement(btn.dataset.id));
    });

    navigate('stock-detail');
  }

  function buildMovementRows(item, moves) {
    let running = 0;
    const rows = [];
    for (const m of moves) {
      if (m.movType === 'stocktake') running = m.qty;
      else if (m.movType === 'receipt') running += m.qty;
      else if (m.movType === 'issue') running = Math.max(0, running - m.qty);
      rows.push({ m, after: running });
    }
    return [...rows].reverse().slice(0, 50).map(({ m, after }) => {
      const typeLabel = { receipt: '? Príjem', issue: '? Výdej', stocktake: '= Inventura' }[m.movType] || m.movType;
      const typeClass = { receipt: 'receipt-c', issue: 'issue-c', stocktake: 'stocktake-c' }[m.movType] || '';
      const qtySign = m.movType === 'issue' ? `-${fmtN(m.qty, 0)}` : m.movType === 'receipt' ? `+${fmtN(m.qty, 0)}` : `=${fmtN(m.qty, 0)}`;
      return `<tr>
        <td>${fmtDT(m.timestamp)}</td>
        <td class="${typeClass}">${typeLabel}</td>
        <td class="num ${typeClass}">${qtySign} ${esc(item.unit || 'ks')}</td>
        <td class="num">${fmtN(after, 0)} ${esc(item.unit || 'ks')}</td>
        <td class="note-td">${esc(m.note || '—')}</td>
        <td><button class="btn-del" data-id="${esc(m.id)}" title="Smazat">?</button></td>
      </tr>`;
    }).join('');
  }

  function buildStockHistoryTable(item, moves) {
    if (!moves.length) {
      return '<div class="empty-state" style="padding:18px 0"><p>Žádné pohyby — history není k dispozici.</p></div>';
    }
    let running = 0;
    const rows = [];
    for (const m of moves) {
      let delta;
      if (m.movType === 'stocktake') { delta = m.qty - running; running = m.qty; }
      else if (m.movType === 'receipt') { delta = m.qty; running += m.qty; }
      else if (m.movType === 'issue') { delta = -m.qty; running = Math.max(0, running - m.qty); }
      else { delta = 0; }
      rows.push({ m, after: running, delta });
    }
    const typeLabel = { receipt: '? Príjem', issue: '? Výdej', stocktake: '= Inventura' };
    const typeClass = { receipt: 'receipt-c', issue: 'issue-c', stocktake: 'stocktake-c' };
    const html = [...rows].reverse().slice(0, 100).map(({ m, after, delta }) => {
      const sign = delta > 0 ? `+${fmtN(delta, 0)}` : delta < 0 ? `${fmtN(delta, 0)}` : `=${fmtN(m.qty, 0)}`;
      const dClass = delta > 0 ? 'receipt-c' : delta < 0 ? 'issue-c' : 'stocktake-c';
      return `<tr>
        <td>${fmtDT(m.timestamp)}</td>
        <td class="${typeClass[m.movType] || ''}">${typeLabel[m.movType] || m.movType}</td>
        <td class="num ${dClass}">${sign} ${esc(item.unit || 'ks')}</td>
        <td class="num"><strong>${fmtN(after, 0)}</strong> ${esc(item.unit || 'ks')}</td>
        <td class="note-td">${esc(m.note || '—')}</td>
      </tr>`;
    }).join('');
    return `<table class="data-table">
      <thead><tr><th>Datum</th><th>Typ</th><th>Zmena</th><th>Stav po</th><th>Poznámka</th></tr></thead>
      <tbody>${html}</tbody>
    </table>`;
  }

  async function deleteMovement(id) {
    showConfirm('Smazat tento pohyb skladu?', async () => {
      await idbDelete(ST_MOVES, id);
      S.movements = S.movements.filter(m => m.id !== id);
      renderStockOverview();
      renderAlerts();
      if (S.detailArticle) openStockDetail(S.detailArticle);
      showToast('Pohyb smazán');
    });
  }

  async function deleteMovementAdmin(id) {
    if (!isAdmin()) { showToast('Mazání pohybu — jen admin', 'error'); return; }
    showConfirm('Smazat tento pohyb skladu? (Admin)', async () => {
      await idbDelete(ST_MOVES, id);
      S.movements = S.movements.filter(m => m.id !== id);
      renderStockOverview();
      renderAlerts();
      renderStockLog();
      if (S.detailArticle) openStockDetail(S.detailArticle);
      showToast('Pohyb smazán');
    });
  }

  function renderAlerts() {
    const alertItems = S.items
      .filter(it => it.isActive !== false && computeStock(it).status !== 'ok')
      .sort((a, b) => computeStock(a).daysLeft - computeStock(b).daysLeft);

    const list = el('alerts-list');
    if (!alertItems.length) {
      list.innerHTML = `<div class="empty-state"><div class="empty-state-icon">?</div><p>Žádná upozornení — vše v porádku.</p></div>`;
      return;
    }
    list.innerHTML = alertItems.map(it => {
      const m = computeStock(it);
      const lbl = m.status === 'crit' ? 'Kritické' : 'Varování';
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
            <span class="metric-mini-lbl">Na sklade</span>
          </div>
          <div class="metric-mini">
            <span class="metric-mini-val ${m.status === 'crit' ? 'crit-c' : 'warn-c'}">${fmtDays(m.daysLeft)}</span>
            <span class="metric-mini-lbl">Zásoba na</span>
          </div>
          <div class="metric-mini">
            <span class="metric-mini-val">${it.leadTimeDays || '—'}</span>
            <span class="metric-mini-lbl">Dod. lhuta</span>
          </div>
        </div>
      </div>`;
    }).join('');
    list.querySelectorAll('.item-card').forEach(c => {
      c.addEventListener('click', () => openStockDetail(c.dataset.article));
    });
  }

  function setupMovementEntry() {
    document.querySelectorAll('.mov-type-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.mov-type-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        S.movType = btn.dataset.type;
        updateMovQtyLabel();
        updateMovPreview();
      });
    });

    const searchEl = el('mov-item-search');
    const resultsEl = el('mov-item-results');

    searchEl.addEventListener('input', () => {
      const q = searchEl.value.toLowerCase();
      if (!q) {
        resultsEl.classList.add('hidden');
        return;
      }
      const matches = S.items
        .filter(it => it.isActive !== false)
        .filter(it =>
          (it.articleNumber || '').toLowerCase().includes(q) ||
          (it.name || '').toLowerCase().includes(q) ||
          (it.category || '').toLowerCase().includes(q)
        )
        .slice(0, 8);

      if (!matches.length) {
        resultsEl.innerHTML = '<div class="dropdown-item"><span class="di-name">Nic nenalezeno</span></div>';
      } else {
        resultsEl.innerHTML = matches.map(it => {
          const m = computeStock(it);
          return `<div class="dropdown-item" data-a="${esc(it.articleNumber)}">
            <span class="di-name">${esc(it.name || it.articleNumber)}</span>
            <span class="di-code">${esc(it.articleNumber)} · ${esc(it.unit || 'ks')}</span>
            <span class="di-stock">Na sklade: ${fmtN(m.onHand, 0)} ${esc(it.unit || 'ks')}</span>
          </div>`;
        }).join('');
      }
      resultsEl.classList.remove('hidden');
      resultsEl.querySelectorAll('[data-a]').forEach(d => {
        d.addEventListener('click', () => {
          const item = S.items.find(it => it.articleNumber === d.dataset.a);
          if (item) selectMovItem(item);
        });
      });
    });

    document.addEventListener('click', e => {
      if (!resultsEl.contains(e.target) && e.target !== searchEl) {
        resultsEl.classList.add('hidden');
      }
    });

    el('mov-minus').addEventListener('click', () => {
      const v = parseFloat(el('mov-qty').value || '0');
      if (v > 0) {
        el('mov-qty').value = Math.max(0, v - 1);
        updateMovPreview();
      }
    });
    el('mov-plus').addEventListener('click', () => {
      el('mov-qty').value = parseFloat(el('mov-qty').value || '0') + 1;
      updateMovPreview();
    });
    el('mov-qty').addEventListener('input', updateMovPreview);
    el('mov-save-btn').addEventListener('click', saveMovement);
  }

  function prefillMovItem(item) {
    const chip = el('mov-item-selected');
    chip.classList.remove('hidden');
    chip.innerHTML = `
      <div>
        <div class="sc-name">${esc(item.name || item.articleNumber)}</div>
        <div class="sc-code">${esc(item.articleNumber)}</div>
      </div>
      <button class="sc-clear" id="mov-sc-clear">?</button>`;
    el('mov-sc-clear').addEventListener('click', clearMovItem);
    el('mov-item-search').value = '';
    el('mov-unit-hint').textContent = 'Jednotka: ' + (item.unit || 'ks');
    el('mov-save-btn').disabled = false;
    updateMovQtyLabel();
    updateMovPreview();
  }

  function selectMovItem(item) {
    S.movItem = item;
    el('mov-item-results').classList.add('hidden');
    prefillMovItem(item);
  }

  function clearMovItem() {
    S.movItem = null;
    el('mov-item-selected').classList.add('hidden');
    el('mov-preview').classList.add('hidden');
    el('mov-save-btn').disabled = true;
    el('mov-unit-hint').textContent = '';
  }

  function updateMovQtyLabel() {
    const labels = {
      receipt: 'Prijímaný pocet kusu *',
      issue: 'Vydávaný pocet kusu *',
      stocktake: 'Aktuální stav na sklade (nová hodnota) *',
    };
    el('mov-qty-label').textContent = labels[S.movType] || 'Množství *';
  }

  function updateMovPreview() {
    if (!S.movItem) return;
    const qty = parseFloat(el('mov-qty').value) || 0;
    const cur = computeStock(S.movItem).onHand;
    let after;
    if (S.movType === 'receipt') after = cur + qty;
    else if (S.movType === 'issue') after = Math.max(0, cur - qty);
    else after = qty;

    const unit = S.movItem.unit || 'ks';
    const fakeMove = {
      articleNumber: S.movItem.articleNumber,
      movType: S.movType,
      qty,
      timestamp: new Date().toISOString(),
      id: '__tmp__',
    };
    const fakeMoves = [...S.movements, fakeMove];
    const origMoves = S.movements;
    S.movements = fakeMoves;
    const nm = computeStock(S.movItem);
    S.movements = origMoves;

    el('mov-prev-current').textContent = `${fmtN(cur, 0)} ${unit}`;
    el('mov-prev-after').textContent = `${fmtN(after, 0)} ${unit}`;
    const statusLbl = { ok: 'OK ?', warn: '? Varování', crit: '?? Kritické' }[nm.status];
    const statusEl = el('mov-prev-status');
    statusEl.textContent = statusLbl;
    statusEl.style.color = { ok: 'var(--ok)', warn: 'var(--warn)', crit: 'var(--crit)' }[nm.status];
    el('mov-preview').classList.remove('hidden');
  }

  async function saveMovement() {
    if (!S.movItem) { showToast('Vyberte položku', 'error'); return; }
    const qty = parseFloat(el('mov-qty').value);
    if (isNaN(qty) || qty < 0) { showToast('Zadejte platné množství', 'error'); return; }

    const move = {
      id: genId('mov'),
      articleNumber: S.movItem.articleNumber,
      movType: S.movType,
      qty,
      note: el('mov-note').value.trim() || undefined,
      timestamp: new Date().toISOString(),
      deviceId: cfg.deviceId,
    };

    el('mov-save-btn').disabled = true;
    try {
      await idbPut(ST_MOVES, move);
      S.movements.push(move);
      S.movements.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
      const typeLabel = { receipt: 'Príjem', issue: 'Výdej', stocktake: 'Inventura' }[S.movType];
      showToast(`${typeLabel} uložen`, 'success');
      el('mov-qty').value = '';
      el('mov-note').value = '';
      clearMovItem();
      renderStockOverview();
      renderAlerts();
      navigate('stock-overview');
    } catch (err) {
      showToast('Chyba: ' + err.message, 'error');
    } finally {
      el('mov-save-btn').disabled = false;
    }
  }

  function renderItemsMgmt() {
    const list = el('items-mgmt-list');
    if (!S.items.length) {
      list.innerHTML = `<div class="empty-state"><div class="empty-state-icon">??</div><p>Žádné položky.\nKliknete + Pridat položku nebo importujte JSON.</p></div>`;
      return;
    }
    const byCategory = {};
    S.items.forEach(it => {
      const cat = it.category || 'Ostatní';
      if (!byCategory[cat]) byCategory[cat] = [];
      byCategory[cat].push(it);
    });

    list.innerHTML = Object.entries(byCategory)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([cat, items]) => `
        <div style="margin-bottom:6px">
          <div style="font-size:.6rem;font-weight:600;letter-spacing:.1em;text-transform:uppercase;color:var(--text-faint);padding:10px 0 6px">${esc(cat)}</div>
          ${items.map(it => {
            const m = computeStock(it);
            return `<div class="mgmt-card" style="margin-bottom:5px">
              <div class="mgmt-info">
                <div class="mgmt-name">${esc(it.name || it.articleNumber)}</div>
                <div class="mgmt-meta">${esc(it.articleNumber)} · ${esc(it.unit || 'ks')} · Na sklade: ${fmtN(m.onHand, 0)}</div>
              </div>
              <div class="mgmt-actions">
                ${it.orderUrl ? `<a href="${esc(it.orderUrl)}" target="_blank" rel="noopener" class="btn-icon-sm admin-only" title="Objednat">??</a>` : ''}
                <button class="btn-icon-sm" data-edit="${esc(it.articleNumber)}" title="Upravit">?</button>
                <button class="btn-icon-sm danger" data-del="${esc(it.articleNumber)}" title="Smazat">?</button>
              </div>
            </div>`;
          }).join('')}
        </div>`).join('');

    list.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () => openItemModal(b.dataset.edit)));
    list.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', () => deleteItem(b.dataset.del)));
  }

  function openItemModal(articleNumber) {
    if (!isAdmin()) { showToast('Jen admin muže spravovat položky', 'error'); return; }

    S.editingItem = articleNumber
      ? (S.items.find(it => it.articleNumber === articleNumber) || null)
      : null;

    el('item-modal-title').textContent = S.editingItem ? 'Upravit položku' : 'Nová položka';
    const it = S.editingItem || {};
    el('im-name').value = it.name || '';
    el('im-article').value = it.articleNumber || '';
    el('im-unit').value = it.unit || '';
    el('im-category').value = it.category || '';
    el('im-supplier').value = it.supplier || '';
    el('im-moq').value = it.MOQ || '';
    el('im-lead').value = it.leadTimeDays || '';
    el('im-safety').value = it.safetyDays || '';
    el('im-minqty').value = it.minQty || '';
    el('im-url').value = it.orderUrl || '';
    el('im-article').readOnly = !!S.editingItem;
    el('item-modal').classList.remove('hidden');
    el('im-name').focus();
  }

  async function saveItemModal() {
    if (!isAdmin()) { showToast('Jen admin muže spravovat položky', 'error'); return; }

    const name = el('im-name').value.trim();
    const article = el('im-article').value.trim().toUpperCase().replace(/\s+/g, '-');
    if (!name) { showToast('Zadejte název', 'error'); return; }
    if (!article) { showToast('Zadejte císlo artiklu', 'error'); return; }
    if (!S.editingItem && S.items.find(it => it.articleNumber === article)) {
      showToast('Artikl s tímto císlem již existuje', 'error');
      return;
    }

    const item = {
      articleNumber: article,
      name,
      unit: el('im-unit').value.trim() || 'ks',
      category: el('im-category').value.trim() || '',
      supplier: el('im-supplier').value.trim() || '',
      MOQ: parseInt(el('im-moq').value, 10) || 1,
      leadTimeDays: parseInt(el('im-lead').value, 10) || 7,
      safetyDays: parseInt(el('im-safety').value, 10) || 7,
      minQty: parseFloat(el('im-minqty').value) || 0,
      orderUrl: el('im-url').value.trim() || undefined,
      isActive: true,
    };

    await idbPut(ST_ITEMS, item);
    const idx = S.items.findIndex(it => it.articleNumber === article);
    if (idx >= 0) S.items[idx] = item;
    else S.items.push(item);

    el('item-modal').classList.add('hidden');
    renderItemsMgmt();
    renderStockOverview();
    showToast(S.editingItem ? 'Položka upravena' : 'Položka pridána', 'success');
  }

  async function deleteItem(articleNumber) {
    if (!isAdmin()) { showToast('Jen admin muže spravovat položky', 'error'); return; }

    showConfirm(`Smazat položku "${articleNumber}" vcetne všech pohybu?`, async () => {
      await idbDelete(ST_ITEMS, articleNumber);
      const toDelete = S.movements.filter(m => m.articleNumber === articleNumber);
      for (const m of toDelete) await idbDelete(ST_MOVES, m.id);
      S.items = S.items.filter(it => it.articleNumber !== articleNumber);
      S.movements = S.movements.filter(m => m.articleNumber !== articleNumber);
      renderItemsMgmt();
      renderStockOverview();
      renderAlerts();
      showToast('Položka smazána');
    });
  }

  function renderStockLog() {
    const itemMap = {};
    S.items.forEach(it => { itemMap[it.articleNumber] = it; });

    const runningMap = {};
    const enriched = S.movements.map(m => {
      const r = runningMap[m.articleNumber] ?? 0;
      let after;
      if (m.movType === 'stocktake') after = m.qty;
      else if (m.movType === 'receipt') after = r + m.qty;
      else after = Math.max(0, r - m.qty);
      runningMap[m.articleNumber] = after;
      return {
        ...m,
        stockAfter: after,
        itemName: itemMap[m.articleNumber]?.name || m.articleNumber,
        unit: itemMap[m.articleNumber]?.unit || 'ks',
      };
    });

    const q = S.logSearch.toLowerCase();
    const filtered = enriched.filter(m => {
      const matchType = S.logFilter === 'all' || m.movType === S.logFilter;
      const matchQ = !q
        || m.articleNumber.toLowerCase().includes(q)
        || m.itemName.toLowerCase().includes(q)
        || (m.note || '').toLowerCase().includes(q);
      const matchDate = dateRangeFilter(m.timestamp, S.logDateFrom, S.logDateTo);
      return matchType && matchQ && matchDate;
    });

    const wrap = el('stock-log-wrap');
    if (!filtered.length) {
      wrap.innerHTML = `<div class="empty-state"><div class="empty-state-icon">??</div><p>Žádné pohyby neodpovídají filtru.</p></div>`;
      return;
    }

    const typeLabel = { receipt: '? Príjem', issue: '? Výdej', stocktake: '= Inventura' };
    const typeClass = { receipt: 'receipt-c', issue: 'issue-c', stocktake: 'stocktake-c' };

    const rows = [...filtered].reverse().map(m => {
      const sign = m.movType === 'issue' ? `-${fmtN(m.qty, 0)}` : m.movType === 'receipt' ? `+${fmtN(m.qty, 0)}` : `=${fmtN(m.qty, 0)}`;
      const dClass = m.movType === 'receipt' ? 'receipt-c' : m.movType === 'issue' ? 'issue-c' : 'stocktake-c';
      return `<tr>
        <td>${fmtDT(m.timestamp)}</td>
        <td class="log-item-name" data-article="${esc(m.articleNumber)}" style="cursor:pointer">${esc(m.itemName)}<br><span style="font-size:.6rem;color:var(--text-faint);letter-spacing:.05em">${esc(m.articleNumber)}</span></td>
        <td class="${typeClass[m.movType] || ''}">${typeLabel[m.movType] || m.movType}</td>
        <td class="num ${dClass}">${sign} <small>${esc(m.unit)}</small></td>
        <td class="num"><strong>${fmtN(m.stockAfter, 0)}</strong> <small>${esc(m.unit)}</small></td>
        <td class="note-td">${esc(m.note || '—')}</td>
        <td><button class="btn-del admin-only" data-id="${esc(m.id)}" title="Smazat (jen admin)">?</button></td>
      </tr>`;
    }).join('');

    wrap.innerHTML = `<table class="data-table">
      <thead><tr>
        <th>Datum</th><th>Položka</th><th>Typ</th><th>Zmena</th><th>Stav po</th><th>Poznámka</th><th></th>
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
    const itemMap = {};
    S.items.forEach(it => { itemMap[it.articleNumber] = it; });
    const runningMap = {};
    const header = ['timestamp', 'article_number', 'name', 'category', 'unit', 'movement_type', 'qty', 'stock_after', 'note'];
    const rows = [csvRow(header)];
    S.movements.forEach(m => {
      const it = itemMap[m.articleNumber] || {};
      const r = runningMap[m.articleNumber] ?? 0;
      let after;
      if (m.movType === 'stocktake') after = m.qty;
      else if (m.movType === 'receipt') after = r + m.qty;
      else after = Math.max(0, r - m.qty);
      runningMap[m.articleNumber] = after;
      rows.push(csvRow([
        m.timestamp,
        m.articleNumber,
        it.name || '',
        it.category || '',
        it.unit || 'ks',
        m.movType,
        m.qty,
        after,
        m.note || '',
      ]));
    });
    dlBlob(rows.join('\r\n'), 'text/csv;charset=utf-8', `pohyby_skladu_${fmtFileDT()}.csv`);
  }

  return {
    getMovements,
    computeStock,
    renderStockOverview,
    openStockDetail,
    buildMovementRows,
    buildStockHistoryTable,
    deleteMovement,
    deleteMovementAdmin,
    renderAlerts,
    setupMovementEntry,
    prefillMovItem,
    selectMovItem,
    clearMovItem,
    updateMovQtyLabel,
    updateMovPreview,
    saveMovement,
    renderItemsMgmt,
    openItemModal,
    saveItemModal,
    deleteItem,
    renderStockLog,
    exportCSVStockLog,
  };
}