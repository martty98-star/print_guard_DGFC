# PrintGuard

PrintGuard is an offline-first production helper app for DGFC. The frontend is a classic-script vanilla JS PWA; server-side integrations run through Netlify Functions plus a few Windows/Node support scripts. Persistent operational data lives in Neon PostgreSQL.

For the current architecture, see `ARCHITECTURE.md`.
For the complete environment / secret / path inventory, see `docs/configuration.generated.md`.

## Runtime areas

- Frontend app shell: `index.html`, `app.js`, `app/`, `scripts/`, `reports/`
- Netlify API surface: `netlify/functions/`
- Shared backend helpers: `netlify/functions/_lib/`
- Print server / workstation support: `SubmitTool-sync/`, `server-postpurchase/`, `SERVER_BACKEND/`
- Database docs: `sql/`

## Canonical configuration

The canonical Neon DB variable is `NEON_DATABASE_URL`.
Legacy aliases `DATABASE_URL` and `NETLIFY_DATABASE_URL` still exist in some helpers, so keep them aligned until those call sites are normalized.

Runtime database precedence is:

```text
NETLIFY_DATABASE_URL -> DATABASE_URL -> NEON_DATABASE_URL
```

If more than one of these keys exists in Netlify, the first non-empty value wins. Keep only the intended production value in sync across deploy contexts, or preferably use a single canonical key, to avoid silent mismatches after credential or ownership migrations.

Other commonly required vars:

- `ADMIN_API_KEY`
- `ADMIN_PIN`
- `POSTPURCHASE_OPERATOR_PIN`
- `POST_PURCHASE_API_BASE_URL`
- `POST_PURCHASE_API_TOKEN`
- `POST_PURCHASE_API_ORDERS_PATH`
- `POST_PURCHASE_API_SUPPLIER_SYSTEM_CODE`
- `VAPID_PUBLIC_KEY`
- `VAPID_PRIVATE_KEY`
- `VAPID_SUBJECT`
- `SUBMIT_TOOL_LOG_ROOT`
- `PROCESSED_PRINT_ORDERS_ROOT`
- `COLORADO_ACCOUNTING_ROOT`
- `PRINTGUARD_PDF_HELPER_PORT`

## Admin API authentication

Sensitive Netlify Functions require a server-side API key. Configure it only in Netlify environment variables or local `.env` files used by Node tooling.

```bash
ADMIN_API_KEY=long_random_server_key
ADMIN_PIN=human_admin_pin_or_password
POSTPURCHASE_OPERATOR_PIN=operator_orders_pin
```

- `ADMIN_API_KEY` is for server-to-server/internal automation only. Never put it in frontend JavaScript, HTML, localStorage, or any bundled asset.
- `ADMIN_PIN` is for browser admin mode. The browser sends the entered PIN as `x-admin-pin`; the Netlify Function validates it server-side.
- `POSTPURCHASE_OPERATOR_PIN` is for operators who need to view and update Post Purchase order lifecycle states. The browser sends it as `x-postpurchase-pin`; it does not unlock admin-only destructive actions.

## Post Purchase integration

Required for the Post Purchase sync path:

- `POST_PURCHASE_API_BASE_URL`
- `POST_PURCHASE_API_TOKEN`
- `NEON_DATABASE_URL`
- `ADMIN_API_KEY`
- `ADMIN_PIN`
- `POSTPURCHASE_OPERATOR_PIN`
- `SUBMIT_TOOL_LOG_ROOT`

Optional:

- `POST_PURCHASE_API_ORDERS_PATH`
- `POST_PURCHASE_API_SUPPLIER_SYSTEM_CODE`
- `SUBMIT_TOOL_LOG_DAYS`

The API assumptions are still the same:

- endpoint: `/api/purchase-order/get`
- `fromId`: start at `0` on first run; later runs continue from the highest API id already stored
- `limit`: required, clamped to `1-100`
- `supplierSystemCode`: defaults to `desenio_dgfc_printer`

Manual sync:

```bash
node scripts/sync-postpurchase-orders.js
```

Windows Task Scheduler example:

- Program/script: `node`
- Add arguments: `C:\PrintGuard\print_guard_DGFC\scripts\sync-postpurchase-orders.js`
- Start in: `C:\PrintGuard\print_guard_DGFC`

After changing any Netlify environment variable used by Functions, trigger a fresh production deploy so the new value is present in the deployed runtime.

## Submit Tool JobQueue sync

Submit Tool lifecycle confirmation is read from JobQueue logs on NAS.

Required:

- `SUBMIT_TOOL_LOG_ROOT`
- `NEON_DATABASE_URL`

Optional:

- `SUBMIT_TOOL_LOG_DAYS`

Example root:

```bash
SUBMIT_TOOL_LOG_ROOT=\\10.25.0.20\Data\ST_logs\JobQueue
```

Manual sync:

```bash
node scripts/sync-submit-tool-logs.js --days=2
```

The sync is idempotent: repeated runs do not duplicate lifecycle events.

Windows Task Scheduler:

- Task name: `PrintGuard Submit Tool Sync`
- Runner: `C:\PrintGuard\SubmitTool-sync\run-submit-tool-sync.bat`
- Schedule: every 5 minutes

## Processed print orders

Processed XML sync scans the NAS processed-order folder and writes `processed_print_orders`.

Required when used:

- `PROCESSED_PRINT_ORDERS_ROOT` or legacy `ONYX_PROCESSED_XML_ROOT`
- `NEON_DATABASE_URL`

Manual sync:

```bash
node scripts/sync-processed-print-orders.js --days=2
```

## Colorado pipeline

The Colorado pipeline is a Windows/server-side flow around `C:\PrintGuard\ColoradoAccounting` by default.

Key path/setting:

- `COLORADO_ACCOUNTING_ROOT`

The scheduled pipeline is wired through `SERVER_BACKEND/script_server/run_colorado_pipeline.bat` and the associated Task Scheduler XML.

## Push notifications

Push subscription and notification delivery require matching VAPID keys:

- `VAPID_PUBLIC_KEY`
- `VAPID_PRIVATE_KEY`
- `VAPID_SUBJECT`

The public key is embedded in `index.html`; the private key stays server-side in Netlify env vars.

## Local helper scripts

- `scripts/audit-db-schema.js`
- `scripts/pdf-open-helper.js`
- `scripts/export-colorado-monthly.js`
- `scripts/sync-postpurchase-orders.js`
- `scripts/sync-processed-print-orders.js`
- `scripts/sync-submit-tool-logs.js`

## Notes for operators

- Keep the service worker in mind during deploys: stale caches can make an old shell look healthy.
- `docs/configuration.generated.md` is the source of truth for current config inventory.
- `ARCHITECTURE.md` is the best summary of the current modularization shape.
