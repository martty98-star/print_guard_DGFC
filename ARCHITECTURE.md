# PrintGuard Architecture Notes

PrintGuard is an offline-first production helper app for DGFC print operations. The frontend is a vanilla JavaScript PWA, while server-side integrations run through Netlify Functions and scheduled Node scripts. Persistent operational data is stored in Neon PostgreSQL.

This document describes the current project shape and a practical path for modularizing the app without a risky rewrite.

## Current Runtime Shape

- `index.html` contains the main application screens and static markup.
- `app.js` is the main browser orchestrator. It owns global state, screen routing, event binding, local persistence, and many inventory/Colorado workflows.
- `styles.css` contains global app styling.
- `sw.js` is the service worker for PWA caching and notification click behavior.
- `reports/` contains mostly reusable domain/reporting utilities that can run in browser and Node.
- `scripts/` contains browser UI modules and server/workstation sync scripts.
- `netlify/functions/` contains HTTP endpoints.
- `netlify/functions/_lib/` contains shared backend helpers.
- `sql/` contains schema/view migrations.
- `SubmitTool-sync/`, `server-postpurchase/`, and `SERVER_BACKEND/` are operational/server-side support areas.

## Top-Level Structure

```text
.
├─ app.js                         Main browser app shell and legacy orchestration
├─ index.html                     Static screens and script loading
├─ styles.css                     Global styling
├─ sw.js                          Service worker
├─ i18n.js                        UI translations
├─ reports/                       Domain/reporting utilities
├─ scripts/                       Browser UI modules and sync scripts
├─ netlify/functions/             Netlify HTTP endpoints
├─ netlify/functions/_lib/        Backend shared modules
├─ sql/                           Database schema and view SQL
├─ SubmitTool-sync/               SubmitTool sync support
├─ server-postpurchase/           Post Purchase sync/server support
└─ SERVER_BACKEND/                Local/backend operational support files
```

## Important Frontend Areas

### App Shell

- `app.js`
  - Global config/state.
  - Screen navigation.
  - Admin/operator PIN handling.
  - Inventory flows.
  - Colorado accounting flows.
  - Print log flows.
  - Delegates some newer screens to modules in `scripts/`.

### Browser UI Modules

- `scripts/checklist-api.js`
  - Checklist API client.
- `scripts/checklist-ui.js`
  - Checklist browser UI.
- `scripts/postpurchase-ui.js`
  - Processed Print Orders / Order Pipeline UI.
  - PDF open/copy actions.
  - Reprint request modal.
- `scripts/print-log-ui.js`
  - Print log UI.
- `scripts/settings-ui.js`
  - Settings UI.
- `scripts/core-utils.js`, `scripts/dom-utils.js`, `scripts/export-utils.js`, `scripts/push-utils.js`
  - Shared frontend helpers.

### Domain/Report Modules

- `reports/checklist-domain.js` / `reports/checklist-domain.ts`
  - Checklist recurrence, local date keys, occurrence keys, weekday normalization.
- `reports/csv.js`
  - CSV formatting helpers.
- `reports/date.js`
  - Date/range helpers.
- `reports/stock.js`
  - Stock calculations.
- `reports/colorado.js`
  - Colorado accounting/report calculations.
- `reports/printLog.js`
  - Print log domain logic.
- `reports/notification-*`
  - Notification event/model/rule helpers.

These modules are the best examples of the direction the codebase should move toward: pure functions, narrow inputs/outputs, and little or no direct DOM access.

## Backend / API Areas

### Netlify Functions

- `netlify/functions/sync.js`
  - General sync endpoint.
- `netlify/functions/postpurchase-orders.js`
  - Incoming Post Purchase orders endpoint and sync trigger.
- `netlify/functions/processed-print-orders.js`
  - Processed XML order listing and reprint request handling.
- `netlify/functions/order-pipeline.js`
  - Joined incoming/processed pipeline endpoint.
- `netlify/functions/checklist-*.js`
  - Checklist items, completions, evaluation.
- `netlify/functions/print-log-*.js`
  - Print log endpoints.
- `netlify/functions/save-subscription.js`, `send-*.js`
  - Push notification endpoints.

### Backend Shared Modules

- `netlify/functions/_lib/db.js`
  - Neon connection, auth/rate-limit helpers, JSON response helper.
- `netlify/functions/_lib/postpurchase-orders.js`
  - Post Purchase API ingestion and `print_orders_received` storage.
- `netlify/functions/_lib/processed-print-orders.js`
  - Processed XML order tables, listing, reprint requests.
- `netlify/functions/_lib/order-pipeline.js`
  - `v_print_order_pipeline` view creation and query filters.
- `netlify/functions/_lib/checklist-store.js`
  - Checklist persistence.
- `netlify/functions/_lib/checklist-reminders.js`
  - Reminder occurrence evaluation.
- `netlify/functions/_lib/push-delivery.js`
  - Push delivery helpers.

## Scheduled / Workstation Scripts

- `scripts/sync-postpurchase-orders.js`
  - Pulls incoming orders from Post Purchase API into Neon.
- `scripts/sync-processed-print-orders.js`
  - Scans SubmitTool processed XML files on NAS and upserts `processed_print_orders`.
- `scripts/sync-submit-tool-logs.js`
  - Legacy SubmitTool lifecycle log scanner for workflow confirmation/debugging.
- `scripts/pdf-open-helper.js`
  - Local helper for opening NAS PDF paths from browser UI.
- `scripts/export-colorado-monthly.js`
  - Colorado export helper.

Windows task wrappers:

- `run-postpurchase-sync.bat`
- `run-processed-print-orders-sync.bat`
- `run-submit-tool-sync.bat`
- `run-pdf-open-helper.bat`

## Core Data Flows

### Incoming Orders

```text
Post Purchase API
  -> scripts/sync-postpurchase-orders.js or Netlify endpoint
  -> print_orders_received
```

The incoming API payload is stored in Neon. Orders are upserted by `external_order_id`.

### Processed Orders

```text
NAS processed XML folder
  -> scripts/sync-processed-print-orders.js
  -> processed_print_orders
  -> processed_order_reprint_requests
```

The processed XML table is the source of truth for operator-facing processed orders. Re-running the sync is idempotent.

### Order Pipeline

```text
print_orders_received
  + processed_print_orders
  + processed_order_reprint_requests
  -> v_print_order_pipeline
  -> /.netlify/functions/order-pipeline
  -> scripts/postpurchase-ui.js
```

The UI should not restore manual Submit Tool / Onyx / Colorado checkbox state. The pipeline is read-only except for explicit reprint requests.

### Checklist

```text
Checklist UI
  -> checklist API functions
  -> checklist tables
  -> reports/checklist-domain.js
```

Checklist date/occurrence logic lives in the domain module. Keep timezone and occurrence key generation centralized there.

### Inventory / Colorado / Print Log

These areas are still more tightly coupled to `app.js` than the newer modules. They are good candidates for gradual extraction.

## Current Coupling Hotspots

- `app.js` is still too broad:
  - state model
  - routing
  - DOM binding
  - business logic
  - API calls
  - rendering
- `index.html` contains all screens in one file.
- `styles.css` is global and screen styles are interleaved.
- Some features have both legacy code in `app.js` and newer module code in `scripts/`.
- Backend schema creation is partly in SQL files and partly in `_lib/*` ensure functions.

## Modularization Goals

The safest direction is incremental extraction, not a framework rewrite.

Target module boundaries:

```text
features/
  inventory/
  checklist/
  processed-orders/
  order-pipeline/
  print-log/
  colorado/
  settings/

shared/
  api/
  dom/
  date/
  csv/
  auth/
  state/
  notifications/
```

The immediate goal is not to move everything at once. The first goal is to stop adding new logic to `app.js` when a feature module already exists.

## Suggested Future Structure

```text
src/
├─ app/
│  ├─ bootstrap.js
│  ├─ router.js
│  ├─ state.js
│  └─ config.js
├─ shared/
│  ├─ api/
│  ├─ dom/
│  ├─ date/
│  ├─ csv/
│  └─ auth/
├─ features/
│  ├─ checklist/
│  │  ├─ checklist-domain.js
│  │  ├─ checklist-api.js
│  │  └─ checklist-ui.js
│  ├─ processed-orders/
│  │  ├─ processed-orders-api.js
│  │  ├─ processed-orders-ui.js
│  │  └─ pdf-open.js
│  ├─ order-pipeline/
│  │  ├─ order-pipeline-api.js
│  │  └─ order-pipeline-ui.js
│  ├─ inventory/
│  ├─ colorado/
│  ├─ print-log/
│  └─ settings/
└─ styles/
   ├─ base.css
   ├─ layout.css
   ├─ components.css
   └─ features/
```

This can be done with plain browser modules first. A bundler can come later if needed.

## Practical Modularization Plan

### Phase 1: Stabilize Existing Boundaries

- Keep `reports/` as domain logic.
- Keep `scripts/*-ui.js` as browser feature modules.
- Keep `netlify/functions/_lib/` as backend domain/data modules.
- Avoid adding new feature logic directly into `app.js`.
- Move only one screen at a time.

Recommended first targets:

1. Processed Print Orders / Order Pipeline
2. Checklist
3. Print Log
4. Settings
5. Colorado
6. Inventory

### Phase 2: Extract API Clients

Create narrow frontend API modules:

```text
scripts/api/
  checklist-api.js
  order-pipeline-api.js
  processed-print-orders-api.js
  print-log-api.js
```

Rules:

- API modules call `fetch`.
- UI modules do not construct endpoint URLs manually.
- UI modules receive data and render.
- Error normalization lives in API/shared helpers.

### Phase 3: Split Rendering From Events

For each feature:

```text
feature-ui.js       render and event binding
feature-api.js      HTTP calls
feature-domain.js   pure logic
```

Example:

```text
processed-orders-ui.js
processed-orders-api.js
processed-orders-domain.js
pdf-open.js
```

### Phase 4: Reduce `app.js`

`app.js` should eventually only:

- initialize config
- initialize shared state
- register screens
- wire top-level navigation
- initialize feature modules

Anything screen-specific should move out.

### Phase 5: CSS Split

Move CSS by responsibility:

```text
styles/
  tokens.css
  base.css
  layout.css
  components/buttons.css
  components/forms.css
  features/checklist.css
  features/processed-orders.css
  features/colorado.css
```

Do this after JS boundaries are clearer, otherwise selectors become hard to reason about.

## Rules For Safe Refactors

- Do not change schema and UI behavior in the same refactor unless required.
- Move code first, then improve it in a second step.
- Keep old function names as wrappers during transition when possible.
- Add small smoke checks with `node --check` for touched JS files.
- Keep feature modules independent of unrelated global state.
- Prefer pure functions for date, CSV, formatting, matching, and status logic.
- Keep all API endpoints returning stable JSON shapes.

## Current High-Value Seams

Good places to start extracting without breaking behavior:

- `scripts/postpurchase-ui.js`
  - Already mostly isolated.
  - Can be split into API, render, reprint modal, PDF open helper.
- `reports/checklist-domain.js`
  - Already pure domain logic.
  - Can become the canonical checklist schedule module.
- `netlify/functions/_lib/order-pipeline.js`
  - Already backend-domain-like.
  - Keep SQL/view/query logic here.
- `reports/csv.js`, `reports/date.js`
  - Good shared utility modules.

Riskier areas:

- Inventory logic inside `app.js`.
- Colorado accounting UI inside `app.js`.
- Global event listeners in `app.js`.
- Shared global state `S`.

## Deployment / Runtime Notes

- Frontend is static PWA assets plus Netlify Functions.
- Neon DB access should stay server-side only.
- Workstation/NAS sync scripts require machine environment variables.
- Browser PDF opening of UNC paths depends on local helper or browser policy.
- Service worker cache version must be bumped after frontend JS/CSS changes.

## Recommended Next Step

Start by turning the Processed Print Orders / Order Pipeline area into the template for future modularization:

1. Create `scripts/order-pipeline-api.js`.
2. Move endpoint URL/query construction out of `scripts/postpurchase-ui.js`.
3. Create `scripts/pdf-open.js`.
4. Keep `scripts/postpurchase-ui.js` as render/event orchestration only.
5. Once stable, repeat the same pattern for Checklist.
