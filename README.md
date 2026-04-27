PrintGuard

Inventory and print-audit app for DGFC. The project runs as an offline-first PWA and uses Netlify Functions for server-side integrations with Neon PostgreSQL.

Post Purchase integration

Required environment variables:
- POST_PURCHASE_API_BASE_URL
- POST_PURCHASE_API_TOKEN
- NEON_DATABASE_URL
- ADMIN_API_KEY
- ADMIN_PIN
- POSTPURCHASE_OPERATOR_PIN
- SUBMIT_TOOL_LOG_ROOT

Optional environment variables:
- POST_PURCHASE_API_ORDERS_PATH
- POST_PURCHASE_API_SUPPLIER_SYSTEM_CODE
- SUBMIT_TOOL_LOG_DAYS

Admin API authentication

Sensitive Netlify Functions require a server-side API key. Configure it only in Netlify environment variables or local `.env` files used by Netlify tooling:

```bash
ADMIN_API_KEY=long_random_server_key
ADMIN_PIN=human_admin_pin_or_password
POSTPURCHASE_OPERATOR_PIN=operator_orders_pin
```

`ADMIN_API_KEY` is for server-to-server/internal automation only. Never put it in frontend JavaScript, HTML, localStorage, or any bundled asset.

`ADMIN_PIN` is for browser admin mode. The browser sends the entered PIN as `x-admin-pin`; the Netlify Function validates it server-side. Do not commit either value to Git.

`POSTPURCHASE_OPERATOR_PIN` is for operators who only need to view and update Post Purchase order lifecycle states. The browser sends it as `x-postpurchase-pin`; it does not unlock admin-only destructive actions.

Post Purchase API examples:

```bash
curl -H "x-api-key: YOUR_KEY" \
  "https://your-api.netlify.app/.netlify/functions/postpurchase-orders"

curl -H "x-admin-pin: YOUR_PIN" \
  "https://your-api.netlify.app/.netlify/functions/postpurchase-orders"

curl -H "x-postpurchase-pin: YOUR_OPERATOR_PIN" \
  "https://your-api.netlify.app/.netlify/functions/postpurchase-orders"

curl -X POST \
  -H "x-api-key: YOUR_KEY" \
  -H "x-internal-sync: true" \
  -H "content-type: application/json" \
  -d "{\"limit\":100}" \
  "https://your-api.netlify.app/.netlify/functions/postpurchase-orders"

curl -X PUT \
  -H "x-postpurchase-pin: YOUR_OPERATOR_PIN" \
  -H "content-type: application/json" \
  -d "{\"externalOrderId\":\"PS123\",\"stage\":\"COLORADO_PRINTED\",\"completed\":true}" \
  "https://your-api.netlify.app/.netlify/functions/postpurchase-orders"
```

Manual sync

Run the sync manually from CLI:

```bash
node scripts/sync-postpurchase-orders.js
```

Optional flags:
- --fromId 0
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
- endpoint: /api/purchase-order/get
- fromId: send 0 on the first run; pagination continues from the last id in each page, and later scheduled runs start from the highest API id already stored in PrintGuard
- limit: required, clamped to 1-100
- supplierSystemCode: defaults to desenio_dgfc_printer

Order numbers are derived from order.ecommerce_id. PS orders are stored with a PS prefix, for example PS4746094; DS orders keep the numeric ecommerce id. The sync stores the full source API object in print_orders_received.source_payload and upserts by external_order_id, so reruns do not create duplicates.

Submit Tool JobQueue log sync

Submit Tool lifecycle confirmation is read from JobQueue logs on NAS. Configure the root folder on the machine running the scheduled script:

```bash
SUBMIT_TOOL_LOG_ROOT=\\10.25.0.20\Data\ST_logs\JobQueue
NEON_DATABASE_URL=postgresql://...
```

Run manually:

```bash
node scripts/sync-submit-tool-logs.js --days=2
```

The script scans date folders like `2026-04-27`, parses `.txt` files, stores parsed rows in `print_lifecycle_events`, and marks matching received orders as Submit Tool confirmed using the first `PrintJob <ORDER>, status=WorkflowRun` event. It is idempotent: repeated runs do not duplicate lifecycle events.

Windows Task Scheduler example:

```bat
@echo off
cd /d C:\PrintGuard\print_guard_DGFC
node scripts\sync-submit-tool-logs.js --days=2 >> C:\PrintGuard\logs\submit-tool-sync.log 2>&1
```

Submit Tool event storage:

- `print_lifecycle_events.source` = `submit_tool`
- `print_lifecycle_events.source_module` = Submit Tool module from the line, for example `JobQueue`
- `print_lifecycle_events.event_type` = `PrintJob` or `OpenPrintJob`
- `print_lifecycle_events.order_identifier` = the PS or numeric job id from the log
- `print_lifecycle_events.event_status` = `WorkflowRun`, `Opened`, or `runWF=True`
- `print_orders_received.submit_tool_at` / `submit_tool_processed_at` = first matched `WorkflowRun` timestamp
- `print_orders_received.submit_tool_status` = `confirmed` for log sync, `manual` for UI override
