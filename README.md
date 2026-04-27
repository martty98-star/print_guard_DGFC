PrintGuard

Inventory and print-audit app for DGFC. The project runs as an offline-first PWA and uses Netlify Functions for server-side integrations with Neon PostgreSQL.

Post Purchase integration

Required environment variables:
- POST_PURCHASE_API_BASE_URL
- POST_PURCHASE_API_TOKEN
- NEON_DATABASE_URL

Optional environment variables:
- POST_PURCHASE_API_ORDERS_PATH
- POST_PURCHASE_API_SUPPLIER_SYSTEM_CODE

Manual sync

Run the sync manually from CLI:

```bash
node scripts/sync-postpurchase-orders.js
```

Optional flags:
- --fromid 0
- --limit 100
- --updated-from 2026-04-01T00:00:00Z
- --created-from 2026-04-01T00:00:00Z
- --supplier-system-code desenio_dgfc_printer

The script is non-interactive and exits with code 1 on failure, so it is safe for Windows Task Scheduler.

Windows Task Scheduler

Example action:
- Program/script: node
- Add arguments: C:\PrintGuard\print_guard_DGFC\scripts\sync-postpurchase-orders.js
- Start in: C:\PrintGuard\print_guard_DGFC

API assumptions

The current implementation assumes the Post Purchase orders endpoint supports:
- fromid: send 0 on the first run, then the highest API order id already stored in PrintGuard
- limit: required, clamped to 1-100
- supplierSystemCode: defaults to desenio_dgfc_printer

The sync stores the full source API object in print_orders_received.source_payload and upserts by external_order_id, so reruns do not create duplicates.
