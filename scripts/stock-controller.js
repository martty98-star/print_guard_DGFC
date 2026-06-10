(function attachPrintGuardStockController(global) {
  'use strict';

  function initStockController(deps) {
    const {
      S,
      computeStock,
      el,
      esc,
      fmtN,
      i18n,
      navigate,
      deleteMovement,
      openItemModal,
      renderStockLog,
      renderStockOverview,
      saveItemModal,
      saveMovement,
      statusLabel,
      exportCSVStockLog,
    } = deps;

    function updateMovQtyLabel() {
      const labels = {
        receipt: 'Přijímaný počet kusů *',
        issue: 'Vydávaný počet kusů *',
        stocktake: 'Aktuální stav na skladě (nová hodnota) *',
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
      const statusLbl =
        {
          ok: `${statusLabel('ok')} ✓`,
          warn: `⚠ ${statusLabel('warn')}`,
          crit: `🔴 ${statusLabel('crit')}`,
        }[nm.status] || statusLabel(nm.status);
      const statusEl = el('mov-prev-status');
      statusEl.textContent = statusLbl;
      statusEl.style.color = {
        ok: 'var(--ok)',
        warn: 'var(--warn)',
        crit: 'var(--crit)',
      }[nm.status];
      el('mov-preview').classList.remove('hidden');
    }

    function clearMovItem() {
      S.movItem = null;
      el('mov-item-selected').classList.add('hidden');
      el('mov-preview').classList.add('hidden');
      el('mov-save-btn').disabled = true;
      el('mov-unit-hint').textContent = '';
    }

    function prefillMovItem(item) {
      const chip = el('mov-item-selected');
      chip.classList.remove('hidden');
      chip.innerHTML = `
    <div>
      <div class="sc-name">${esc(item.name || item.articleNumber)}</div>
      <div class="sc-code">${esc(item.articleNumber)}</div>
    </div>
    <button class="sc-clear" id="mov-sc-clear">✕</button>`;
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

    function setupMovementEntry() {
      document.querySelectorAll('.mov-type-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
          document
            .querySelectorAll('.mov-type-btn')
            .forEach((b) => b.classList.remove('active'));
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
          .filter((it) => it.isActive !== false)
          .filter(
            (it) =>
              (it.articleNumber || '').toLowerCase().includes(q) ||
              (it.name || '').toLowerCase().includes(q) ||
              (it.category || '').toLowerCase().includes(q),
          )
          .slice(0, 8);

        if (!matches.length) {
          resultsEl.innerHTML =
            '<div class="dropdown-item"><span class="di-name">Nic nenalezeno</span></div>';
        } else {
          const lblOnHand = i18n('stock.metric.onhand');
          resultsEl.innerHTML = matches
            .map((it) => {
              const m = computeStock(it);
              return `<div class="dropdown-item" data-a="${esc(it.articleNumber)}">
          <span class="di-name">${esc(it.name || it.articleNumber)}</span>
          <span class="di-code">${esc(it.articleNumber)} · ${esc(it.unit || 'ks')}</span>
          <span class="di-stock">${lblOnHand}: ${fmtN(m.onHand, 0)} ${esc(it.unit || 'ks')}</span>
        </div>`;
            })
            .join('');
        }
        resultsEl.classList.remove('hidden');
        resultsEl.querySelectorAll('[data-a]').forEach((d) => {
          d.addEventListener('click', () => {
            const item = S.items.find((it) => it.articleNumber === d.dataset.a);
            if (item) selectMovItem(item);
          });
        });
      });

      document.addEventListener('click', (e) => {
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

    function bindStockOverviewControls() {
      el('stock-search').addEventListener('input', (e) => {
        S.stockSearch = e.target.value;
        renderStockOverview();
      });
      document.querySelectorAll('.pill').forEach((p) =>
        p.addEventListener('click', () => {
          document
            .querySelectorAll('.pill')
            .forEach((pp) => pp.classList.remove('active'));
          p.classList.add('active');
          S.stockFilter = p.dataset.filter;
          renderStockOverview();
        }),
      );
      document.querySelectorAll('.stat-chip').forEach((chip) =>
        chip.addEventListener('click', () => {
          const f = chip.dataset.filter;
          document
            .querySelectorAll('.pill')
            .forEach((p) =>
              p.classList.toggle('active', p.dataset.filter === f),
            );
          S.stockFilter = f;
          renderStockOverview();
        }),
      );
    }

    function bindItemModalControls() {
      el('add-item-btn').addEventListener('click', () => openItemModal(null));
      el('item-modal-close').addEventListener('click', () =>
        el('item-modal').classList.add('hidden'),
      );
      el('item-modal-cancel').addEventListener('click', () =>
        el('item-modal').classList.add('hidden'),
      );
      el('item-modal-save').addEventListener('click', saveItemModal);
    }

    function bindStockLogControls() {
      el('stock-log-search').addEventListener('input', (e) => {
        S.logSearch = e.target.value;
        renderStockLog();
      });
      document.querySelectorAll('[data-logfilter]').forEach((p) =>
        p.addEventListener('click', () => {
          document
            .querySelectorAll('[data-logfilter]')
            .forEach((pp) => pp.classList.remove('active'));
          p.classList.add('active');
          S.logFilter = p.dataset.logfilter;
          renderStockLog();
        }),
      );
      el('stock-log-export-btn').addEventListener('click', exportCSVStockLog);

      el('stock-log-from').addEventListener('change', (e) => {
        S.logDateFrom = e.target.value;
        renderStockLog();
      });
      el('stock-log-to').addEventListener('change', (e) => {
        S.logDateTo = e.target.value;
        renderStockLog();
      });
      el('stock-log-clear-dates').addEventListener('click', () => {
        S.logDateFrom = '';
        S.logDateTo = '';
        el('stock-log-from').value = '';
        el('stock-log-to').value = '';
        renderStockLog();
      });
    }

    function bindStockDetailControls(item) {
      el('detail-add-mov-btn')?.addEventListener('click', () => {
        S.movItem = item;
        prefillMovItem(item);
        navigate('stock-movement');
      });

      const dc = el('detail-content');
      dc.querySelectorAll('.detail-tab').forEach((tab) => {
        tab.addEventListener('click', () => {
          dc.querySelectorAll('.detail-tab').forEach((t) =>
            t.classList.remove('active'),
          );
          tab.classList.add('active');
          const which = tab.dataset.tab;
          dc.querySelector(
            '.detail-tab-pane[data-pane="movements"]',
          )?.classList.toggle('hidden', which !== 'movements');
          dc.querySelector(
            '.detail-tab-pane[data-pane="history"]',
          )?.classList.toggle('hidden', which !== 'history');
        });
      });

      dc.querySelectorAll('.btn-del').forEach((btn) => {
        btn.addEventListener('click', () => deleteMovement(btn.dataset.id));
      });
    }

    el('fab-movement').addEventListener('click', () =>
      navigate('stock-movement'),
    );
    bindStockOverviewControls();
    bindItemModalControls();
    setupMovementEntry();
    bindStockLogControls();

    return {
      clearMovItem,
      bindStockDetailControls,
      prefillMovItem,
      updateMovPreview,
      updateMovQtyLabel,
    };
  }

  global.PrintGuardStockController = {
    initStockController,
  };
})(window);
