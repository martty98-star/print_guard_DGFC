export function createColoradoModule(core) {
  const {
    cfg,
    S,
    ST_CORECS,
    idbPut,
    idbDelete,
    genId,
    navigate,
    isAdmin,
    el,
    esc,
    fmtN,
    fmtDT,
    toLocalDT,
    toISOfromDT,
    showToast,
    showConfirm,
    dateRangeFilter,
  } = core;

  const MACHINES = [
    { id: 'colorado1', label: 'Colorado 1' },
    { id: 'colorado2', label: 'Colorado 2' },
  ];

  function getCoRecs(machineId) {
    return S.coRecords
      .filter(r => r.machineId === machineId)
      .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
  }

  function computeCoIntervals(machineId) {
    const recs = getCoRecs(machineId);
    return recs.slice(1).map((cur, i) => {
      const prev = recs[i];
      const ms = new Date(cur.timestamp) - new Date(prev.timestamp);
      const days = Math.max(ms / 86400000, 0.0001);
      const inkUsed = Math.max(0, cur.inkTotalLiters - prev.inkTotalLiters);
      const mediaUsed = Math.max(0, cur.mediaTotalM2 - prev.mediaTotalM2);
      const inkPerM2 = mediaUsed > 0 ? inkUsed / mediaUsed : null;
      const inkCost = inkUsed * cfg.inkCost;
      const mediaCost = mediaUsed * cfg.mediaCost;
      const totalCost = inkCost + mediaCost;
      const costPerM2 = mediaUsed > 0 ? totalCost / mediaUsed : null;
      return {
        from: prev.timestamp,
        to: cur.timestamp,
        days,
        machineId,
        inkTotalTo: cur.inkTotalLiters,
        mediaTotalTo: cur.mediaTotalM2,
        inkUsed,
        mediaUsed,
        inkPerDay: inkUsed / days,
        mediaPerDay: mediaUsed / days,
        inkPerM2,
        inkCost,
        mediaCost,
        totalCost,
        costPerM2,
        recordId: cur.id,
      };
    });
  }

  function computeCoStats(machineId) {
    const ivs = computeCoIntervals(machineId);
    const N = cfg.rollingN;
    const recent = ivs.slice(-N);
    if (!recent.length) return null;

    const avg = arr => arr.reduce((s, v) => s + v, 0) / arr.length;
    const avgInkDay = avg(recent.map(r => r.inkPerDay));
    const avgMediaDay = avg(recent.map(r => r.mediaPerDay));
    const validPM2 = recent.filter(r => r.inkPerM2 !== null);
    const avgInkPM2 = validPM2.length ? avg(validPM2.map(r => r.inkPerM2)) : null;
    const hasCosts = cfg.inkCost > 0 || cfg.mediaCost > 0;
    const validCost = recent.filter(r => r.costPerM2 !== null);
    const avgCostPM2 = hasCosts && validCost.length ? avg(validCost.map(r => r.costPerM2)) : null;

    const recs = getCoRecs(machineId);
    return {
      machineId,
      recordCount: recs.length,
      intervalCount: ivs.length,
      avgInkDay,
      avgInkMonth: avgInkDay * 30,
      avgMediaDay,
      avgMediaMonth: avgMediaDay * 30,
      avgInkPM2,
      avgCostPM2,
      hasCosts,
      last: recs[recs.length - 1],
    };
  }

  function renderCoDashboard() {
    MACHINES.forEach(({ id, label }) => renderMachineCard(id, label));
    renderCombinedCard();
  }

  function renderMachineCard(machineId, label) {
    const wrap = el('card-' + machineId);
    if (!wrap) return;
    const recs = getCoRecs(machineId);
    const s = computeCoStats(machineId);

    if (!s || recs.length < 2) {
      wrap.innerHTML = `<div class="mc-header">
        <span class="mc-label">${esc(label)}</span>
        <span class="mc-badge">${recs.length} záznam${recs.length === 1 ? '' : 'u'}</span>
      </div>
      <div class="mc-empty">
        Potreba alespon 2 záznamy pro výpocet spotreby.
        ${recs.length === 1 ? `<br>Poslední: <strong>${fmtDT(recs[0].timestamp)}</strong> · Ink: ${fmtN(recs[0].inkTotalLiters, 2)} L · Médium: ${fmtN(recs[0].mediaTotalM2, 1)} m²` : ''}
      </div>`;
      return;
    }

    wrap.innerHTML = `
      <div class="mc-header">
        <span class="mc-label">${esc(label)}</span>
        <span class="mc-badge">${s.recordCount} záznamu · ${s.intervalCount} intervalu</span>
      </div>
      <div class="metrics-grid">
        <div class="metric-block ink-bg">
          <span class="metric-big">${fmtN(s.avgInkDay, 3)}</span>
          <span class="metric-unit">L / den</span>
          <span class="metric-desc">Prumerná spotreba inkoustu</span>
        </div>
        <div class="metric-block ink-bg">
          <span class="metric-big">${fmtN(s.avgInkMonth, 2)}</span>
          <span class="metric-unit">L / mesíc</span>
          <span class="metric-desc">Odhad mesícní spotreby</span>
        </div>
        <div class="metric-block">
          <span class="metric-big">${fmtN(s.avgMediaDay, 1)}</span>
          <span class="metric-unit">m² / den</span>
          <span class="metric-desc">Prumerná spotreba média</span>
        </div>
        <div class="metric-block">
          <span class="metric-big">${fmtN(s.avgMediaMonth, 0)}</span>
          <span class="metric-unit">m² / mesíc</span>
          <span class="metric-desc">Odhad mesícní spotreby</span>
        </div>
        <div class="metric-block ink-bg">
          <span class="metric-big">${s.avgInkPM2 !== null ? fmtN(s.avgInkPM2, 4) : '—'}</span>
          <span class="metric-unit">L / m²</span>
          <span class="metric-desc">Spotreba inkoustu na m²</span>
        </div>
        ${s.hasCosts && s.avgCostPM2 !== null ? `<div class="metric-block cost-bg">
          <span class="metric-big">${fmtN(s.avgCostPM2, 2)}</span>
          <span class="metric-unit">Kc / m²</span>
          <span class="metric-desc">Prumerný náklad na m²</span>
        </div>` : ''}
      </div>
      <div class="mc-last">
        Poslední záznam: <strong>${fmtDT(s.last.timestamp)}</strong> ·
        Ink celkem: <strong>${fmtN(s.last.inkTotalLiters, 2)} L</strong> ·
        Médium celkem: <strong>${fmtN(s.last.mediaTotalM2, 1)} m²</strong>
      </div>`;
  }

  function renderCombinedCard() {
    const wrap = el('card-combined');
    if (!wrap) return;
    const valid = MACHINES.map(m => computeCoStats(m.id)).filter(s => s && s.intervalCount > 0);
    if (!valid.length) {
      wrap.innerHTML = `<div class="mc-header"><span class="mc-label">Celkem — obe tiskárny</span></div><div class="mc-empty">Data nejsou k dispozici.</div>`;
      return;
    }
    const sum = fn => valid.reduce((s, v) => s + fn(v), 0);
    const inkMonth = sum(v => v.avgInkMonth);
    const mediaMonth = sum(v => v.avgMediaMonth);
    const hasCosts = cfg.inkCost > 0 || cfg.mediaCost > 0;
    const costMonth = hasCosts ? inkMonth * cfg.inkCost + mediaMonth * cfg.mediaCost : null;

    wrap.innerHTML = `
      <div class="mc-header">
        <span class="mc-label">Celkem — obe tiskárny</span>
        <span class="mc-badge">kombinovaný prehled</span>
      </div>
      <div class="metrics-grid">
        <div class="metric-block ink-bg">
          <span class="metric-big">${fmtN(sum(v => v.avgInkDay), 3)}</span>
          <span class="metric-unit">L / den</span>
          <span class="metric-desc">Inkoust celkem</span>
        </div>
        <div class="metric-block ink-bg">
          <span class="metric-big">${fmtN(inkMonth, 2)}</span>
          <span class="metric-unit">L / mesíc</span>
          <span class="metric-desc">Inkoust celkem / mesíc</span>
        </div>
        <div class="metric-block">
          <span class="metric-big">${fmtN(sum(v => v.avgMediaDay), 1)}</span>
          <span class="metric-unit">m² / den</span>
          <span class="metric-desc">Médium celkem</span>
        </div>
        <div class="metric-block">
          <span class="metric-big">${fmtN(mediaMonth, 0)}</span>
          <span class="metric-unit">m² / mesíc</span>
          <span class="metric-desc">Médium celkem / mesíc</span>
        </div>
        ${hasCosts && costMonth !== null ? `<div class="metric-block cost-bg">
          <span class="metric-big">${fmtN(costMonth, 0)}</span>
          <span class="metric-unit">Kc / mesíc</span>
          <span class="metric-desc">Odhadované celkové náklady</span>
        </div>` : ''}
      </div>`;
  }

  function setupCoEntry() {
    document.querySelectorAll('.machine-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.machine-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        updateCoPreview();
      });
    });
    el('co-ink').addEventListener('input', updateCoPreview);
    el('co-media').addEventListener('input', updateCoPreview);
    el('co-timestamp').value = toLocalDT(new Date().toISOString());
    el('co-save-btn').addEventListener('click', saveCoEntry);
  }

  function getSelectedMachine() {
    return document.querySelector('.machine-btn.active')?.dataset.machine || null;
  }

  function updateCoPreview() {
    const machineId = getSelectedMachine();
    const inkVal = parseFloat(el('co-ink').value);
    const mediaVal = parseFloat(el('co-media').value);
    if (!machineId || isNaN(inkVal) || isNaN(mediaVal)) {
      el('co-preview').classList.add('hidden');
      return;
    }
    const recs = getCoRecs(machineId);
    const last = recs[recs.length - 1];
    if (!last) {
      el('co-preview').classList.remove('hidden');
      return;
    }

    const inkUsed = Math.max(0, inkVal - last.inkTotalLiters);
    const mediaUsed = Math.max(0, mediaVal - last.mediaTotalM2);
    const ts = new Date(toISOfromDT(el('co-timestamp').value));
    const days = Math.max((ts - new Date(last.timestamp)) / 86400000, 0.0001);
    const ratio = mediaUsed > 0 ? inkUsed / mediaUsed : null;

    el('co-prev-ink').textContent = `+${fmtN(inkUsed, 3)} L`;
    el('co-prev-media').textContent = `+${fmtN(mediaUsed, 1)} m²`;
    el('co-prev-ratio').textContent = ratio !== null ? `${fmtN(ratio, 4)} L/m²` : '—';
    el('co-prev-days').textContent = `${fmtN(days, 1)} dní`;
    el('co-preview').classList.remove('hidden');
  }

  async function saveCoEntry() {
    const machineId = getSelectedMachine();
    if (!machineId) { showToast('Vyberte tiskárnu', 'error'); return; }
    const inkVal = parseFloat(el('co-ink').value);
    const mediaVal = parseFloat(el('co-media').value);
    if (isNaN(inkVal) || inkVal < 0) { showToast('Zadejte platnou hodnotu inkoustu', 'error'); return; }
    if (isNaN(mediaVal) || mediaVal < 0) { showToast('Zadejte platnou hodnotu média', 'error'); return; }

    const rec = {
      id: genId('co'),
      machineId,
      timestamp: toISOfromDT(el('co-timestamp').value) || new Date().toISOString(),
      inkTotalLiters: inkVal,
      mediaTotalM2: mediaVal,
      note: el('co-note').value.trim() || undefined,
      createdAt: new Date().toISOString(),
    };

    el('co-save-btn').disabled = true;
    try {
      await idbPut(ST_CORECS, rec);
      S.coRecords.push(rec);
      S.coRecords.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
      showToast('Záznam Colorado uložen', 'success');
      el('co-ink').value = '';
      el('co-media').value = '';
      el('co-note').value = '';
      el('co-timestamp').value = toLocalDT(new Date().toISOString());
      el('co-preview').classList.add('hidden');
      renderCoDashboard();
      renderCoHistory();
      navigate('co-dashboard');
    } catch (err) {
      showToast('Chyba: ' + err.message, 'error');
    } finally {
      el('co-save-btn').disabled = false;
    }
  }

  function renderCoHistory() {
    const machineId = S.coHistMachine;
    document.querySelectorAll('.hist-tab').forEach(b =>
      b.classList.toggle('active', b.dataset.machine === machineId)
    );

    const recs = getCoRecs(machineId);
    const ivs = computeCoIntervals(machineId);
    const ivByRec = {};
    ivs.forEach(iv => { ivByRec[iv.recordId] = iv; });

    const wrap = el('co-history-wrap');
    if (!recs.length) {
      wrap.innerHTML = `<div class="empty-state"><div class="empty-state-icon">??</div><p>Žádné záznamy.</p></div>`;
      return;
    }

    const hasCosts = cfg.inkCost > 0 || cfg.mediaCost > 0;
    const filteredRecs = recs.filter(rec => dateRangeFilter(rec.timestamp, S.coDateFrom, S.coDateTo));

    if (!filteredRecs.length) {
      wrap.innerHTML = `<div class="empty-state"><div class="empty-state-icon">??</div><p>Žádné záznamy v daném období.</p></div>`;
      return;
    }

    const rows = [...filteredRecs].reverse().map(rec => {
      const iv = ivByRec[rec.id];
      return `<tr>
        <td>${fmtDT(rec.timestamp)}</td>
        <td class="num">${fmtN(rec.inkTotalLiters, 3)}</td>
        <td class="num">${fmtN(rec.mediaTotalM2, 1)}</td>
        <td class="num delta">${iv ? '+' + fmtN(iv.inkUsed, 3) : '—'}</td>
        <td class="num delta">${iv ? '+' + fmtN(iv.mediaUsed, 1) : '—'}</td>
        <td class="num">${iv && iv.inkPerM2 !== null ? fmtN(iv.inkPerM2, 4) : '—'}</td>
        ${hasCosts ? `<td class="num">${iv && iv.costPerM2 !== null ? fmtN(iv.costPerM2, 2) : '—'}</td>` : ''}
        <td class="note-td">${esc(rec.note || '—')}</td>
        <td><button class="btn-del admin-only" data-id="${esc(rec.id)}" title="Smazat (jen admin)">?</button></td>
      </tr>`;
    }).join('');

    wrap.innerHTML = `<table class="data-table">
      <thead><tr>
        <th>Datum a cas</th>
        <th>Ink celkem (L)</th>
        <th>Médium celkem (m²)</th>
        <th>? Ink (L)</th>
        <th>? Médium (m²)</th>
        <th>L / m²</th>
        ${hasCosts ? '<th>Kc / m²</th>' : ''}
        <th>Poznámka</th>
        <th></th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>`;

    wrap.querySelectorAll('.btn-del').forEach(btn =>
      btn.addEventListener('click', () => deleteCoRecord(btn.dataset.id))
    );
  }

  async function deleteCoRecord(id) {
    if (!isAdmin()) { showToast('Mazání záznamu Colorado — jen admin', 'error'); return; }
    showConfirm('Smazat tento záznam Colorado? (Admin)', async () => {
      await idbDelete(ST_CORECS, id);
      S.coRecords = S.coRecords.filter(r => r.id !== id);
      renderCoDashboard();
      renderCoHistory();
      showToast('Záznam smazán');
    });
  }

  return {
    MACHINES,
    getCoRecs,
    computeCoIntervals,
    computeCoStats,
    renderCoDashboard,
    renderMachineCard,
    renderCombinedCard,
    setupCoEntry,
    getSelectedMachine,
    updateCoPreview,
    saveCoEntry,
    renderCoHistory,
    deleteCoRecord,
  };
}