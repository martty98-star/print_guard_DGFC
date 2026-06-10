(function attachPrintGuardStockActions(global) {
  'use strict';

  function createStockActions(deps) {
    const {
      S,
      StockFeature,
      StockStore,
      StockUI,
      Reports,
      adminErrorMessage,
      cfg,
      cloudDelete,
      el,
      esc,
      enqueueStockAction,
      fmtDT,
      fmtDays,
      fmtN,
      genId,
      i18n,
      isAdmin,
      movementLabel,
      navigate,
      renderAlerts,
      renderStockLog,
      renderStockOverview,
      runNotificationDispatch,
      setSyncDirtyReason,
      showConfirm,
      showToast,
      statusLabel,
      stockApiAdapter,
      stockDbAdapter,
    } = deps;

    function getMovements(articleNumber) {
      return StockFeature.getMovements(articleNumber);
    }

    function computeStock(item) {
      return StockFeature.computeStock(item);
    }

    function buildMovementRows(item, moves) {
      return StockUI.buildMovementRows({
        esc,
        fmtDT,
        fmtN,
        item,
        movementLabel,
        moves,
      });
    }

    function buildStockHistoryTable(item, moves) {
      return StockFeature.renderStockHistory(item, moves);
    }

    function openStockDetail(articleNumber) {
      const item = S.items.find((it) => it.articleNumber === articleNumber);
      if (!item) return;
      S.detailArticle = articleNumber;
      el('detail-title').textContent = item.name || articleNumber;

      const stock = computeStock(item);
      const moves = getMovements(articleNumber);
      const statusLbl = statusLabel(stock.status);
      const lblCoverage = i18n('stock.metric.coverage');
      const lblWeekly = i18n('stock.metric.weekly');

      el('detail-content').innerHTML = `
    <div class="detail-hero">
      <span class="badge ${stock.status}" style="display:inline-block;margin-bottom:12px">${statusLbl}</span>
      <div>
        <span class="detail-big">${fmtN(stock.onHand, 0)}</span>
        <span class="detail-unit">${esc(item.unit || 'ks')}</span>
      </div>
      <div class="detail-metrics-grid">
        <div class="dm-item"><span class="dm-val">${fmtDays(stock.daysLeft)}</span><span class="dm-lbl">${lblCoverage}</span></div>
        <div class="dm-item"><span class="dm-val">${stock.avgWeekly > 0 ? fmtN(stock.avgWeekly, 1) : '—'}</span><span class="dm-lbl">${lblWeekly}</span></div>
        <div class="dm-item"><span class="dm-val">${item.leadTimeDays || '—'}</span><span class="dm-lbl">Dod. lhůta (dny)</span></div>
      </div>
    </div>

    <div class="detail-section">
      <div class="detail-section-title">Parametry položky</div>
      <div class="param-row"><span>Číslo artiklu</span><code>${esc(articleNumber)}</code></div>
      ${item.category ? `<div class="param-row"><span>Kategorie</span><span>${esc(item.category)}</span></div>` : ''}
      ${item.supplier ? `<div class="param-row"><span>Dodavatel</span><span>${esc(item.supplier)}</span></div>` : ''}
      ${item.MOQ ? `<div class="param-row"><span>MOQ</span><span>${item.MOQ}</span></div>` : ''}
      ${item.leadTimeDays ? `<div class="param-row"><span>Dodací lhůta</span><span>${item.leadTimeDays} dní</span></div>` : ''}
      ${item.safetyDays ? `<div class="param-row"><span>Bezp. zásoba</span><span>${item.safetyDays} dní</span></div>` : ''}
      ${item.minQty ? `<div class="param-row"><span>Min. množství</span><span>${item.minQty} ${esc(item.unit || 'ks')}</span></div>` : ''}
      ${item.orderUrl ? `<div class="param-row admin-only"><span>Odkaz na objednávku</span><a href="${esc(item.orderUrl)}" target="_blank" rel="noopener" class="order-link">🛒 Objednat</a></div>` : ''}
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
        ${
          moves.length
            ? `<table class="data-table">
          <thead><tr><th>${i18n('table.date')}</th><th>${i18n('table.type')}</th><th>${i18n('table.qty')}</th><th>${i18n('table.after')}</th><th>${i18n('table.note')}</th><th></th></tr></thead>
          <tbody>${buildMovementRows(item, moves)}</tbody>
        </table>`
            : '<div class="empty-state" style="padding:18px 0"><p>Žádné pohyby. Přidejte příjem nebo inventuru.</p></div>'
        }
      </div>
      <div class="detail-tab-pane table-wrap hidden" data-pane="history" style="margin-top:10px">
        ${buildStockHistoryTable(item, moves)}
      </div>
    </div>`;

      StockFeature.bindStockDetailControls(item);
      navigate('stock-detail');
    }

    async function deleteMovementAdmin(id) {
      if (!isAdmin()) {
        showToast('Mazání pohybů — jen admin', 'error');
        return;
      }
      showConfirm('Smazat tento pohyb skladu? (Admin)', async () => {
        const Queue = window.PrintGuardOperatorQueueMode;
        if (Queue && Queue.isQueueRowLocked('stock-log', id)) return;
        if (Queue) Queue.markQueueRowPending('stock-log', id);
        try {
          await StockStore.deleteMovementRemote(id, stockApiAdapter());
          await StockStore.deleteMovementLocal(stockDbAdapter(), id);
          S.movements = S.movements.filter((m) => m.id !== id);
          if (Queue) Queue.markQueueRowDone('stock-log', id);
          const render = () => {
            renderStockOverview();
            renderAlerts();
            renderStockLog();
          };
          if (Queue) Queue.preserveScrollDuringRender(render, 'stock-log');
          else render();
          if (S.detailArticle) openStockDetail(S.detailArticle);
          showToast('Pohyb smazán');
        } catch (err) {
          if (Queue)
            Queue.markQueueRowFailed('stock-log', id, {
              message: adminErrorMessage(err),
            });
          showToast(`Mazání selhalo: ${adminErrorMessage(err)}`, 'error');
        }
      });
    }

    async function deleteMovement(id) {
      showConfirm('Smazat tento pohyb skladu?', async () => {
        const Queue = window.PrintGuardOperatorQueueMode;
        if (Queue && Queue.isQueueRowLocked('stock-detail', id)) return;
        if (Queue) Queue.markQueueRowPending('stock-detail', id);
        try {
          await StockStore.deleteMovementRemote(id, stockApiAdapter());
          await StockStore.deleteMovementLocal(stockDbAdapter(), id);
          S.movements = S.movements.filter((m) => m.id !== id);
          if (Queue) Queue.markQueueRowDone('stock-detail', id);
          const render = () => {
            renderStockOverview();
            renderAlerts();
          };
          if (Queue) Queue.preserveScrollDuringRender(render, 'stock-detail');
          else render();
          if (S.detailArticle) openStockDetail(S.detailArticle);
          showToast('Pohyb smazán');
        } catch (err) {
          if (Queue)
            Queue.markQueueRowFailed('stock-detail', id, {
              message: adminErrorMessage(err),
            });
          showToast(`Mazání selhalo: ${adminErrorMessage(err)}`, 'error');
        }
      });
    }

    async function saveMovement() {
      if (!S.movItem) {
        showToast('Vyberte položku', 'error');
        return;
      }
      const qty = parseFloat(el('mov-qty').value);
      if (isNaN(qty) || qty < 0) {
        showToast('Zadejte platné množství', 'error');
        return;
      }

      const move = {
        id: genId('mov'),
        articleNumber: S.movItem.articleNumber,
        movType: S.movType,
        qty,
        note: el('mov-note').value.trim() || undefined,
        timestamp: new Date().toISOString(),
        deviceId: cfg.deviceId,
      };
      move.updatedAt = move.timestamp;

      el('mov-save-btn').disabled = true;
      try {
        const notifyItem = S.movItem;
        await StockStore.putMovement(stockDbAdapter(), move);
        S.movements.push(move);
        if (typeof enqueueStockAction === 'function') {
          enqueueStockAction({
            entity: 'movement',
            action: 'upsert',
            key: move.id,
            payload: move,
            source: 'ui:movement:create',
            updatedAt: move.updatedAt,
          });
        } else {
          setSyncDirtyReason('stock');
        }
        S.movements.sort(
          (a, b) => new Date(a.timestamp) - new Date(b.timestamp),
        );
        const typeLabel = movementLabel(S.movType);
        showToast(`${typeLabel} — ${i18n('msg.save-success')}`, 'success');
        el('mov-qty').value = '';
        el('mov-note').value = '';
        StockFeature.clearMovementForm();
        renderStockOverview();
        renderAlerts();
        navigate('stock-overview');
        runNotificationDispatch(
          Reports.notificationDispatch?.emitStockMovementCreated?.(
            move,
            notifyItem,
          ),
          'stock movement event',
        );
      } catch (err) {
        showToast('Chyba: ' + err.message, 'error');
      } finally {
        el('mov-save-btn').disabled = false;
      }
    }

    function renderItemsMgmt() {
      const list = el('items-mgmt-list');
      const lblOnHand = i18n('stock.metric.onhand');
      if (!S.items.length) {
        list.innerHTML =
          '<div class="empty-state"><div class="empty-state-icon">📋</div><p>Žádné položky.\nKlikněte + Přidat položku nebo importujte JSON.</p></div>';
        return;
      }
      const byCategory = {};
      S.items.forEach((it) => {
        const cat = it.category || 'Ostatní';
        if (!byCategory[cat]) byCategory[cat] = [];
        byCategory[cat].push(it);
      });

      list.innerHTML = Object.entries(byCategory)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(
          ([cat, items]) => `
    <div style="margin-bottom:6px">
      <div style="font-size:.6rem;font-weight:600;letter-spacing:.1em;text-transform:uppercase;color:var(--text-faint);padding:10px 0 6px">${esc(cat)}</div>
      ${items
        .map((it) => {
          const stock = computeStock(it);
          return `<div class="mgmt-card" style="margin-bottom:5px">
          <div class="mgmt-info">
            <div class="mgmt-name">${esc(it.name || it.articleNumber)}</div>
            <div class="mgmt-meta">${esc(it.articleNumber)} · ${esc(it.unit || 'ks')} · ${lblOnHand}: ${fmtN(stock.onHand, 0)}</div>
          </div>
          <div class="mgmt-actions">
            ${it.orderUrl ? `<a href="${esc(it.orderUrl)}" target="_blank" rel="noopener" class="btn-icon-sm admin-only" title="Objednat">🛒</a>` : ''}
            <button class="btn-icon-sm" data-edit="${esc(it.articleNumber)}" title="Upravit">✎</button>
            <button class="btn-icon-sm danger" data-del="${esc(it.articleNumber)}" title="Smazat">✕</button>
          </div>
        </div>`;
        })
        .join('')}
    </div>`,
        )
        .join('');

      list
        .querySelectorAll('[data-edit]')
        .forEach((b) =>
          b.addEventListener('click', () => openItemModal(b.dataset.edit)),
        );
      list
        .querySelectorAll('[data-del]')
        .forEach((b) =>
          b.addEventListener('click', () => deleteItem(b.dataset.del)),
        );
    }

    function openItemModal(articleNumber) {
      if (!isAdmin()) {
        showToast('Jen admin může spravovat položky', 'error');
        return;
      }

      S.editingItem = articleNumber
        ? S.items.find((it) => it.articleNumber === articleNumber) || null
        : null;

      el('item-modal-title').textContent = S.editingItem
        ? 'Upravit položku'
        : 'Nová položka';
      const item = S.editingItem || {};
      el('im-name').value = item.name || '';
      el('im-article').value = item.articleNumber || '';
      el('im-unit').value = item.unit || '';
      el('im-category').value = item.category || '';
      el('im-supplier').value = item.supplier || '';
      el('im-moq').value = item.MOQ || '';
      el('im-lead').value = item.leadTimeDays || '';
      el('im-safety').value = item.safetyDays || '';
      el('im-minqty').value = item.minQty || '';
      el('im-url').value = item.orderUrl || '';
      el('im-article').readOnly = Boolean(S.editingItem);
      el('item-modal').classList.remove('hidden');
      el('im-name').focus();
    }

    async function saveItemModal() {
      if (!isAdmin()) {
        showToast('Jen admin může spravovat položky', 'error');
        return;
      }

      const name = el('im-name').value.trim();
      const article = el('im-article')
        .value.trim()
        .toUpperCase()
        .replace(/\s+/g, '-');
      if (!name) {
        showToast('Zadejte název', 'error');
        return;
      }
      if (!article) {
        showToast('Zadejte číslo artiklu', 'error');
        return;
      }
      if (
        !S.editingItem &&
        S.items.find((it) => it.articleNumber === article)
      ) {
        showToast('Artikl s tímto číslem již existuje', 'error');
        return;
      }

      const updatedAt = new Date().toISOString();
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
        updatedAt,
      };

      await StockStore.putItem(stockDbAdapter(), item);
      const idx = S.items.findIndex((it) => it.articleNumber === article);
      if (idx >= 0) S.items[idx] = item;
      else S.items.push(item);
      if (typeof enqueueStockAction === 'function') {
        enqueueStockAction({
          entity: 'item',
          action: 'upsert',
          key: article,
          payload: item,
          source: S.editingItem ? 'ui:item:update' : 'ui:item:create',
          updatedAt,
        });
      } else {
        setSyncDirtyReason('stock');
      }

      el('item-modal').classList.add('hidden');
      renderItemsMgmt();
      renderStockOverview();
      showToast(
        S.editingItem ? 'Položka upravena' : 'Položka přidána',
        'success',
      );
    }

    async function deleteItem(articleNumber) {
      if (!isAdmin()) {
        showToast('Jen admin může spravovat položky', 'error');
        return;
      }

      showConfirm(
        `Smazat položku "${articleNumber}" včetně všech pohybů?`,
        async () => {
          try {
            await cloudDelete('item', articleNumber);
            await StockStore.deleteItem(stockDbAdapter(), articleNumber);
            await StockStore.deleteMovementsForArticle(
              stockDbAdapter(),
              S.movements,
              articleNumber,
            );
            S.items = S.items.filter(
              (it) => it.articleNumber !== articleNumber,
            );
            S.movements = S.movements.filter(
              (m) => m.articleNumber !== articleNumber,
            );
            setSyncDirtyReason('stock');
            renderItemsMgmt();
            renderStockOverview();
            renderAlerts();
            showToast('Položka smazána');
          } catch (err) {
            showToast(`Mazání selhalo: ${adminErrorMessage(err)}`, 'error');
          }
        },
      );
    }

    return {
      deleteItem,
      deleteMovement,
      deleteMovementAdmin,
      openItemModal,
      openStockDetail,
      renderItemsMgmt,
      saveItemModal,
      saveMovement,
    };
  }

  global.PrintGuardStockActions = {
    createStockActions,
  };
})(window);
