# PrintGuard Architecture Notes

PrintGuard is an offline-first production helper app for DGFC print operations. The frontend is a classic-script vanilla JavaScript PWA. Server-side integrations run through Netlify Functions and a few Windows/Node support scripts. Persistent operational data lives in Neon PostgreSQL.

This document reflects the current repo after the latest modularization passes and the Neon wake-up reduction work.

For the complete env / secret / path inventory, see `docs/configuration.generated.md`.

## Current runtime shape

- `index.html` contains the shell screens and loads scripts in classic order.
- `app.js` is still the browser orchestrator, but it is now narrower and delegates to modules in `app/`.
- `sw.js` is the PWA service worker for caching and notification click behavior.
- `reports/` contains domain/reporting utilities that run in both browser and Node.
- `scripts/` contains browser UI modules plus sync/export helpers.
- `netlify/functions/` contains HTTP endpoints.
- `netlify/functions/_lib/` contains shared backend helpers.
- `SubmitTool-sync/`, `server-postpurchase/`, and `SERVER_BACKEND/` contain machine-specific operational scripts.
- `sql/` contains schema and view SQL.

## Top-level structure

```text
.
├─ app.js                         Main browser orchestrator
├─ app/                           Browser modules exposed on window.PrintGuard*
├─ index.html                     Static screens and script loading
├─ styles.css                     Global styling
├─ sw.js                          Service worker
├─ i18n.js                        UI translations
├─ reports/                       Domain/reporting utilities
├─ scripts/                       Browser UI modules and sync scripts
├─ netlify/functions/             Netlify HTTP endpoints
├─ netlify/functions/_lib/        Backend shared modules
├─ sql/                           Database schema and view SQL
├─ SubmitTool-sync/               Submit Tool log sync support
├─ server-postpurchase/           Post Purchase sync support
└─ SERVER_BACKEND/                Colorado / server-side operational support
```

## Frontend module map

### App bootstrap and shared globals

- `app/config.js`
  - localStorage/sessionStorage-backed app config.
  - exposes `PrintGuardAppConfig`.
- `app/utils.js`
  - pure DOM/formatting helpers.
  - exposes `PrintGuardUtils`.
- `app/admin-auth.js`
  - admin/operator authorization helpers.
  - exposes `PrintGuardAdminAuth`.
- `app/navigation.js`
  - screen routing and mode switching.
  - exposes `PrintGuardNavigation`.
- `app/sync.js`
  - cloud push/pull orchestration, dirty flags, and background sync.
  - exposes `PrintGuardSync`.
- `app/push.js`
  - push enablement and stock-alert dispatch.
  - exposes `PrintGuardPush`.
- `app/push-bridge.js`
  - small push-related bridge helpers.
  - exposes `PrintGuardPushBridge`.
- `app/settings-store.js`
  - persistence for settings data.
  - exposes `PrintGuardSettingsStore`.
- `app/db.js`, `app/auth.js`, `app/reporting.js`, `app/print-log.js`, `app/date-filters.js`, `app/update-checks.js`
  - shared browser-side service modules used by `app.js` and feature UI modules.

### Browser feature modules under `scripts/`

The newer feature slices already live outside `app.js`:

- `scripts/stock-domain.js`, `stock-store.js`, `stock-controller.js`, `stock-feature.js`, `stock-ui.js`
- `scripts/checklist-api.js`, `checklist-state.js`, `checklist-events.js`, `checklist-render.js`, `checklist-ui.js`
- `scripts/order-pipeline-api.js`, `order-pipeline-filters.js`, `order-pipeline-render.js`
- `scripts/print-log-ui.js`
- `scripts/settings-ui.js`
- `scripts/postpurchase-ui.js`
- `scripts/reprint-modal.js`, `scripts/reprint-xml.js`
- `scripts/push-utils.js`
- `scripts/dom-utils.js`, `scripts/core-utils.js`, `scripts/export-utils.js`
- `scripts/pdf-open.js`, `scripts/pdf-open-helper.js`
- `scripts/export-colorado-monthly.js`
- `scripts/sync-postpurchase-orders.js`
- `scripts/sync-processed-print-orders.js`
- `scripts/sync-submit-tool-logs.js`
- `scripts/audit-db-schema.js`

### Domain / report modules

- `reports/stock.js`
  - stock calculations and thresholds.
- `reports/colorado.js`
  - Colorado accounting/report calculations.
- `reports/printLog.js`
  - print-log domain logic.
- `reports/date.js`
  - date/range helpers.
- `reports/csv.js`
  - CSV formatting helpers.
- `reports/checklist-domain.js`
  - checklist recurrence and occurrence helpers.
- `reports/notification-*`
  - notification event/model/rule helpers.

These modules are the model for new code: narrow inputs, small outputs, minimal DOM coupling, and no framework dependency.

## Backend / API areas

### Netlify Functions

- `netlify/functions/sync.js`
  - stock cloud sync endpoint.
- `netlify/functions/postpurchase-orders.js`
  - incoming Post Purchase orders endpoint and sync trigger.
- `netlify/functions/processed-print-orders.js`
  - processed XML order listing and reprint request handling.
- `netlify/functions/order-pipeline.js`
  - combined incoming/processed pipeline endpoint.
- `netlify/functions/checklist-*.js`
  - checklist items, completions, evaluation.
- `netlify/functions/print-log-*.js`
  - print log endpoints.
- `netlify/functions/save-subscription.js`, `send-*.js`
  - push notification endpoints.

### Shared backend modules

- `netlify/functions/_lib/db.js`
  - Neon connection, auth/rate-limit helpers, JSON response helper.
- `netlify/functions/_lib/postpurchase-orders.js`
  - Post Purchase API ingestion and `print_orders_received` storage.
- `netlify/functions/_lib/processed-print-orders.js`
  - processed XML table helpers, listing, reprint requests.
- `netlify/functions/_lib/order-pipeline.js`
  - `v_print_order_pipeline` view creation and filters.
- `netlify/functions/_lib/checklist-store.js`
  - checklist persistence.
- `netlify/functions/_lib/checklist-reminders.js`
  - reminder occurrence evaluation.
- `netlify/functions/_lib/push-delivery.js`
  - push delivery helpers.

## Scheduled / workstation scripts

- `scripts/sync-postpurchase-orders.js`
  - pulls incoming orders from Post Purchase API into Neon.
- `scripts/sync-processed-print-orders.js`
  - scans NAS processed XML files and upserts `processed_print_orders`.
- `scripts/sync-submit-tool-logs.js`
  - Submit Tool JobQueue log scanner for workflow confirmation/debugging.
- `scripts/pdf-open-helper.js`
  - local helper for opening NAS PDF paths from the browser UI.
- `scripts/export-colorado-monthly.js`
  - Colorado export helper.
- `scripts/audit-db-schema.js`
  - read-only schema documentation generator.

Windows task / batch wrappers:

- `run-postpurchase-sync.bat`
- `run-processed-print-orders-sync.bat`
- `run-submit-tool-sync.bat`
- `run-pdf-open-helper.bat`
- `SERVER_BACKEND/script_server/run_colorado_pipeline.bat`
- `SERVER_BACKEND/script_server/Colorado Pipeline.xml`

## Core data flows

### 1) Stock / inventory sync

```text
local IDB / UI state
  -> cloudPush() / cloudPull() in app/sync.js
  -> /.netlify/functions/sync
  -> pg_items + pg_movements + pg_co_records
```

Current behavior:
- manual sync still works
- background sync is no longer timer-driven by default
- background sync only runs when the tab is visible, the browser is online, and the local dirty flag says something changed
- stock alerts are only evaluated when the dirty reasons include `stock` or `all`
- the sync still uses full-state reads/writes; delta sync is still future work

This preserves behavior while reducing unnecessary Neon wake-ups.

### 2) Post Purchase orders

```text
Post Purchase API
  -> scripts/sync-postpurchase-orders.js or Netlify endpoint
  -> print_orders_received
```

Incoming API payloads are stored in Neon and upserted by `external_order_id`.

### 3) Processed orders

```text
NAS processed XML folder
  -> scripts/sync-processed-print-orders.js
  -> processed_print_orders
  -> processed_order_reprint_requests
```

The processed XML table is the source of truth for operator-facing processed orders. Re-running the sync is idempotent.

### 4) Order pipeline

```text
print_orders_received
  + processed_print_orders
  + processed_order_reprint_requests
  -> v_print_order_pipeline
  -> /.netlify/functions/order-pipeline
  -> scripts/postpurchase-ui.js
```

The UI should not restore manual Submit Tool / Onyx / Colorado checkbox state. The pipeline is read-only except for explicit reprint requests.

### 5) Checklist

```text
Checklist UI
  -> checklist API functions
  -> checklist tables
  -> reports/checklist-domain.js
```

Checklist date/occurrence logic lives in the domain module. Keep timezone and occurrence key generation centralized there.

### 6) Submit Tool lifecycle sync

```text
NAS JobQueue logs
  -> scripts/sync-submit-tool-logs.js
  -> print_lifecycle_events
  -> print_orders_received.submit_tool_*
```

This is the operational log bridge between the print server and Neon.

### 7) Colorado pipeline

```text
ColoradoAccounting files
  -> SERVER_BACKEND/script_server/run_colorado_pipeline.bat
  -> ColoradoSync_server.ps1 + Parse-Colorado*.ps1
  -> colorado-upsert/upsert-colorado-json.js
  -> print_accounting_rows + print_accounting_acl_files
```

Colorado data lives outside the repo under `C:\PrintGuard\ColoradoAccounting` by default.

### 8) Push notifications

```text
browser subscription
  -> save-subscription / send-test-push / send-stock-alerts
  -> VAPID keys + Neon subscription state
```

The browser uses the public VAPID key from `index.html`; the server uses the private key from Netlify env vars.

## Operational boundaries

- Classic script loading is still the runtime contract. No bundler, no Vite, no TypeScript migration yet.
- `app.js` remains the bootstrap/orchestrator for legacy glue, but new logic should continue moving into `app/*` or `scripts/*` modules.
- `sw.js` can cache the shell and static assets; stale service-worker caches can make an old deploy look healthy after a migration.
- The canonical env / secret inventory now lives in `docs/configuration.generated.md`.

## Current coupling hotspots

- `app.js` still owns some broad orchestration and legacy feature glue.
- Several features still exist in both legacy and modular form.
- `sync.js` is intentionally still full-state; it is not delta sync yet.
- Push alert evaluation still scans enough stock state to be meaningful work.
- Colorado support remains a separate operational pipeline rather than a browser module.

## Recommended direction

Keep modularizing by feature boundary, not by framework.

Good next slices:

1. continue shrinking `app.js` glue
2. move any remaining shared browser helpers into `app/*`
3. keep current classic script loading until the module boundaries are stable
4. only then consider a bundler or ES-module migration

The key rule is the same: do not add new feature logic to `app.js` if a dedicated module already exists.

