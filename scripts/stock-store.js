(function attachStockStore(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
    return;
  }
  root.StockStore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createStockStore() {
  'use strict';

  function getAllItems(db) {
    return db.idbAll(db.ST_ITEMS);
  }

  function putItem(db, item) {
    return db.idbPut(db.ST_ITEMS, item);
  }

  function deleteItem(db, articleNumber) {
    return db.idbDelete(db.ST_ITEMS, articleNumber);
  }

  function getAllMovements(db) {
    return db.idbAll(db.ST_MOVES);
  }

  function putMovement(db, movement) {
    return db.idbPut(db.ST_MOVES, movement);
  }

  function deleteMovementLocal(db, id) {
    return db.idbDelete(db.ST_MOVES, id);
  }

  async function deleteMovementsForArticle(db, movements, articleNumber) {
    const toDelete = (movements || []).filter(move => move.articleNumber === articleNumber);
    for (const move of toDelete) {
      await deleteMovementLocal(db, move.id);
    }
    return toDelete;
  }

  async function deleteMovementRemote(id, options) {
    const opts = options || {};
    const fetchImpl = opts.fetchImpl || fetch;
    const res = await fetchImpl('/.netlify/functions/delete-stock-movement', {
      method: 'DELETE',
      headers: opts.adminJsonHeaders(),
      cache: 'no-store',
      body: JSON.stringify({
        id,
        clientId: opts.clientId || '',
        operator: opts.operator || '',
      }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json.ok) throw new Error(json.error || 'Cloud delete failed');
    return json;
  }

  function replayStockMovements(items, movements, reports) {
    return reports.stock.buildStockMovementLedger(items, movements);
  }

  return {
    deleteItem,
    deleteMovementLocal,
    deleteMovementRemote,
    deleteMovementsForArticle,
    getAllItems,
    getAllMovements,
    putItem,
    putMovement,
    replayStockMovements,
  };
});
