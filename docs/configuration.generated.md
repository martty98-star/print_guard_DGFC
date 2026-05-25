# PrintGuard configuration inventory

Generated from repository and server-script audit on 2026-05-18.

Scope:
- repository files under `C:\PrintGuard\print_guard_DGFC`
- `netlify/functions/`
- `server-postpurchase/`
- `SubmitTool-sync/`
- `SERVER_BACKEND/`
- `scripts/`
- top-level `.bat`, `.ps1`, `.md`, and config files

Notes:
- No real secret values were found in tracked source files.
- The only concrete key-like value in the frontend is the public VAPID public key in `index.html`; it is intended to be public.
- Several scripts still accept legacy DB aliases (`DATABASE_URL`, `NETLIFY_DATABASE_URL`) after `NEON_DATABASE_URL`. Keep aliases unset or aligned until they are retired.

## 1. Required environment variables

| Variable name | Required where | Used by files | Purpose | Required or optional | Safe to expose publicly? | Notes |
|---|---|---|---|---|---|---|
| `NEON_DATABASE_URL` | Netlify, local PC, print server, cron | `netlify/functions/save-subscription.js`, `send-app-notification.js`, `send-stock-alerts.js`, `send-test-push.js`; `netlify/functions/_lib/db.js`; `netlify/functions/sync.js`; `scripts/audit-db-schema.js`; `scripts/sync-submit-tool-logs.js`; `server-postpurchase/lib/db.js`; `SERVER_BACKEND/script_server/colorado-upsert/upsert-colorado-json.js`; `SubmitTool-sync/sync-submit-tool-logs.js` | Primary Neon/Postgres connection string | Required | No | Canonical DB variable and first DB source. Some code still falls back to legacy aliases only if this is missing. |
| `DATABASE_URL` | Legacy compatibility on Netlify/local/print server | `netlify/functions/_lib/db.js`; `netlify/functions/print-log-arrivals.js`; `print-log-rows.js`; `print-log-summary.js`; `sync.js`; `scripts/audit-db-schema.js`; `server-postpurchase/lib/db.js`; `SubmitTool-sync/sync-submit-tool-logs.js`; `SERVER_BACKEND/script_server/colorado-upsert/upsert-colorado-json.js` | Legacy DB alias | Optional / legacy | No | Keep only while older code paths still reference it. |
| `NETLIFY_DATABASE_URL` | Netlify compatibility | `netlify/functions/_lib/db.js`; `netlify/functions/print-log-arrivals.js`; `print-log-rows.js`; `print-log-summary.js`; `netlify/functions/sync.js`; `server-postpurchase/lib/db.js`; `SubmitTool-sync/sync-submit-tool-logs.js`; `SERVER_BACKEND/script_server/colorado-upsert/upsert-colorado-json.js` | Legacy DB alias used by older Netlify code | Optional / legacy | No | Legacy fallback after `NEON_DATABASE_URL` and `DATABASE_URL`. |
| `ADMIN_API_KEY` | Netlify | `netlify/functions/_lib/db.js`; `netlify/functions/sync.js` | Server-to-server/internal admin auth | Required for admin endpoints | No | Do not expose to browser code, HTML, storage, or logs. |
| `ADMIN_PIN` | Netlify, local PC/browser testing | `netlify/functions/_lib/db.js`; `netlify/functions/sync.js` | Browser admin mode PIN | Required for admin mode | No | Browser sends it as `x-admin-pin`. |
| `POSTPURCHASE_OPERATOR_PIN` | Netlify | `netlify/functions/_lib/db.js` | Operator access PIN for Post Purchase workflows | Required if operator PIN access is used | No | Legacy fallback alias `POSTPURCHASE_PIN` also exists. |
| `POSTPURCHASE_PIN` | Legacy compatibility | `netlify/functions/_lib/db.js` | Legacy alias for operator PIN | Optional / legacy | No | Keep only if something external still relies on it. |
| `POST_PURCHASE_API_BASE_URL` | Netlify, local PC, print server | `netlify/functions/_lib/postpurchase-orders.js`; `server-postpurchase/lib/postpurchase-orders.js`; docs and BAT runners | Base URL for Post Purchase API | Required | Yes | Must stay on the production Post Purchase API host. |
| `POST_PURCHASE_API_TOKEN` | Netlify, local PC, print server | `netlify/functions/_lib/postpurchase-orders.js`; `server-postpurchase/lib/postpurchase-orders.js`; `run-postpurchase-sync.bat`; `server-postpurchase/run-postpurchase-sync.bat`; docs | Bearer token for Post Purchase API | Required | No | Placeholder values remain in BAT files until edited. |
| `POST_PURCHASE_API_ORDERS_PATH` | Netlify, local PC, print server | `netlify/functions/_lib/postpurchase-orders.js`; `server-postpurchase/lib/postpurchase-orders.js`; docs/BATs | API path override for order fetch | Optional | Yes | Default is `/api/purchase-order/get`. |
| `POST_PURCHASE_API_SUPPLIER_SYSTEM_CODE` | Netlify, local PC, print server | `netlify/functions/_lib/postpurchase-orders.js`; `server-postpurchase/lib/postpurchase-orders.js`; docs/BATs | Supplier system code for Post Purchase API | Optional | Yes | Default is `desenio_dgfc_printer`. |
| `VAPID_PUBLIC_KEY` | Netlify, browser frontend | `index.html`; `app/push.js`; `netlify/functions/_lib/push-delivery.js`; `send-app-notification.js`; `send-stock-alerts.js`; `send-test-push.js` | Public VAPID key used by browser push subscription | Required for push | Yes | Public by design. Must match the private key on the server. |
| `VAPID_PRIVATE_KEY` | Netlify | `netlify/functions/_lib/push-delivery.js`; `send-app-notification.js`; `send-stock-alerts.js`; `send-test-push.js` | Private VAPID signing key | Required for push delivery | No | Keep only in Netlify site env vars / secret store. |
| `VAPID_SUBJECT` | Netlify | `netlify/functions/_lib/push-delivery.js`; `send-app-notification.js`; `send-stock-alerts.js`; `send-test-push.js` | Subject/contact string required by web-push | Required for push delivery | Yes | Not a secret, but should still be treated as deployment config. |
| `SUBMIT_TOOL_LOG_ROOT` | Local PC, print server, cron | `scripts/sync-submit-tool-logs.js`; `SubmitTool-sync/sync-submit-tool-logs.js`; `SubmitTool-sync/run-submit-tool-sync.bat`; `SubmitTool-sync/install-task.ps1`; docs | NAS root folder for Submit Tool JobQueue logs | Required for Submit Tool sync | No | Example paths are `\\NAS01\\Data\\ST_logs\\JobQueue` and `\\10.25.0.20\\Data\\ST_logs\\JobQueue`. |
| `SUBMIT_TOOL_LOG_DAYS` | Local PC, cron | `scripts/sync-submit-tool-logs.js`; `SubmitTool-sync/sync-submit-tool-logs.js` | Lookback window for Submit Tool log scan | Optional | Yes | Default is 1 day in `SubmitTool-sync`, 1/2 days in repo runners depending on script arguments. |
| `PROCESSED_PRINT_ORDERS_ROOT` | Local PC, print server | `scripts/sync-processed-print-orders.js`; `run-processed-print-orders-sync.bat`; docs | NAS root for processed XML orders | Required unless `--file` is used | No | Preferred canonical name for the processed orders root. |
| `ONYX_PROCESSED_XML_ROOT` | Legacy compatibility | `scripts/sync-processed-print-orders.js` | Legacy alias for processed orders root | Optional / legacy | No | Keep until all runners are moved to `PROCESSED_PRINT_ORDERS_ROOT`. |
| `PROCESSED_PRINT_ORDERS_DAYS` | Local PC, cron | `scripts/sync-processed-print-orders.js` | Lookback window for processed XML sync | Optional | Yes | Default is 2 days. |
| `PROCESSED_PRINT_ORDERS_TIMEOUT_MS` | Local PC, cron | `scripts/sync-processed-print-orders.js` | Timeout override for processed XML operations | Optional | Yes | Default is 60000 ms. |
| `COLORADO_ACCOUNTING_ROOT` | Local PC, print server | `SERVER_BACKEND/script_server/colorado-upsert/upsert-colorado-json.js`; `SERVER_BACKEND/script_server/run_colorado_pipeline.bat` | Override for Colorado Accounting data root | Optional | No | Default is `C:\PrintGuard\ColoradoAccounting`. |
| `PRINTGUARD_PDF_HELPER_PORT` | Local PC, print server | `scripts/pdf-open-helper.js` | Local HTTP port for the PDF open helper | Optional | Yes | Default is `17891`. |

## 2. Secret inventory

No real secret values were found in tracked files. Only placeholders were found.

| Name | File / location | Masked value | Action needed |
|---|---|---|---|
| `POST_PURCHASE_API_TOKEN` | `run-postpurchase-sync.bat`; `server-postpurchase/run-postpurchase-sync.bat` | `REPLACE_WITH_POST_PURCHASE_API_TOKEN` | Move to env; do not keep inline placeholders in production runners. |
| `NEON_DATABASE_URL` example | `SubmitTool-sync/env.example.txt`; `README.md`; `server-postpurchase/README.md`; `SubmitTool-sync/README.md` | `postgresql://USER:PASSWORD@HOST/DB?sslmode=require` / `postgresql://...` / `PASTE_NEON_DATABASE_URL_HERE` | Keep as example only; do not commit a real connection string. |
| `ADMIN_API_KEY` example | `README.md` | `long_random_server_key` | Keep as example only. |
| `ADMIN_PIN` example | `README.md` | `human_admin_pin_or_password` | Keep as example only. |
| `POSTPURCHASE_OPERATOR_PIN` example | `README.md` | `operator_orders_pin` | Keep as example only. |

## 3. Runtime paths

| Path | Used by | Purpose | Machine where it must exist |
|---|---|---|---|
| `C:\PrintGuard\print_guard_DGFC` | Most root BAT runners and docs | Repository / working directory for the PrintGuard app | Developer PC, build machine, or print server depending on workflow |
| `C:\PrintGuard\logs` | `run-submit-tool-sync.bat`, `run-processed-print-orders-sync.bat`, `run-postpurchase-sync.bat`, `run-pdf-open-helper.bat`, Colorado pipeline scripts | Shared log directory | Print server / workstation that runs scripts |
| `C:\PrintGuard\SubmitTool-sync` | `SubmitTool-sync/*` scripts and docs | Dedicated Submit Tool sync package root | Print server or workstation running Submit Tool sync |
| `C:\PrintGuard\PostPurchase` | `server-postpurchase/README.md` | Dedicated Post Purchase sync package root | Print server or workstation running Post Purchase sync |
| `C:\PrintGuard\ColoradoAccounting` | `SERVER_BACKEND/script_server/ColoradoSync_server.ps1`; parse and upsert scripts | Colorado accounting data root | Print server / workstation hosting Colorado files |
| `C:\PrintGuard\ProcessedPrintOrders-sync` | `run-pdf-open-helper.bat` | Working directory expected by the PDF helper runner | Print server / workstation using the PDF helper |
| `C:\PrintGuard\run_colorado_pipeline.bat` | `SERVER_BACKEND/script_server/Colorado Pipeline.xml` | Scheduled task target | Machine that hosts the Colorado scheduled task |
| `C:\PrintGuard\SubmitTool-sync\run-submit-tool-sync.bat` | `SubmitTool-sync/install-task.ps1` | Scheduled task target for Submit Tool sync | Machine that hosts the Submit Tool scheduled task |
| `C:\PrintGuard\PostPurchase\run-postpurchase-sync.bat` | `server-postpurchase/README.md` | Manual / scheduled Post Purchase sync runner | Print server |
| `\\NAS01\\Data\\ST_logs\\JobQueue` | `SubmitTool-sync/README.md` | Submit Tool JobQueue log share example | Print server / workstation with NAS access |
| `\\10.25.0.20\\Data\\ST_logs\\JobQueue` | `SubmitTool-sync/README.md`; `SubmitTool-sync/env.example.txt`; `run-submit-tool-sync.bat` comments | Alternate Submit Tool NAS share example | Print server / workstation with NAS access |
| `\\10.25.0.20\\Data\\onyx\\orders\\processed` | `run-processed-print-orders-sync.bat` comments | Example processed-order NAS root | Print server / workstation with NAS access |

## 4. Scheduled jobs / cron

| Task name | Script / endpoint | Required env | Frequency | Notes |
|---|---|---|---|---|
| `PrintGuard Submit Tool Sync` | `C:\PrintGuard\SubmitTool-sync\run-submit-tool-sync.bat` via `cmd.exe` | `NEON_DATABASE_URL`, `SUBMIT_TOOL_LOG_ROOT` | Every 5 minutes | Installed by `SubmitTool-sync/install-task.ps1`. Uses the current Windows user and requires NAS access. |
| `\Colorado Pipeline` | `cmd.exe /c "C:\PrintGuard\run_colorado_pipeline.bat"` | `COLORADO_ACCOUNTING_ROOT` is set by the BAT; DB access is read from `NEON_DATABASE_URL` / `DATABASE_URL` / `NETLIFY_DATABASE_URL` by the upsert script | Hourly repetition within a daily trigger window | Defined in `SERVER_BACKEND/script_server/Colorado Pipeline.xml`. |
| Post Purchase Task Scheduler runner | `C:\PrintGuard\PostPurchase\run-postpurchase-sync.bat` | `POST_PURCHASE_API_BASE_URL`, `POST_PURCHASE_API_TOKEN`, `NEON_DATABASE_URL`, `POST_PURCHASE_API_ORDERS_PATH`, `POST_PURCHASE_API_SUPPLIER_SYSTEM_CODE` | Not encoded in repo | Documented in `server-postpurchase/README.md`; frequency is operator-defined. |

## 5. Netlify setup checklist

Set these in the Netlify site that serves PrintGuard:

- `NEON_DATABASE_URL` — required for the Neon-backed functions and push/subscription writes.
- `ADMIN_API_KEY` — required for admin-authenticated functions.
- `ADMIN_PIN` — required for browser admin mode.
- `POSTPURCHASE_OPERATOR_PIN` — required if operator PIN access is used.
- `POST_PURCHASE_API_BASE_URL` — required for Post Purchase sync logic.
- `POST_PURCHASE_API_TOKEN` — required for Post Purchase API access.
- `VAPID_PUBLIC_KEY` — required for browser push subscription.
- `VAPID_PRIVATE_KEY` — required for push delivery.
- `VAPID_SUBJECT` — required for push delivery.

Compatibility variables, only if an external platform still requires them. If present, keep them aligned with `NEON_DATABASE_URL`:

- `DATABASE_URL`
- `NETLIFY_DATABASE_URL`

Recommended, but not strictly required by every route:

- `POST_PURCHASE_API_ORDERS_PATH`
- `POST_PURCHASE_API_SUPPLIER_SYSTEM_CODE`

## 6. Print server setup checklist

On the Windows print server, make sure the following exist:

### Environment variables

- `NEON_DATABASE_URL`
- `SUBMIT_TOOL_LOG_ROOT`
- `POST_PURCHASE_API_BASE_URL`
- `POST_PURCHASE_API_TOKEN`
- `POST_PURCHASE_API_ORDERS_PATH`
- `POST_PURCHASE_API_SUPPLIER_SYSTEM_CODE`
- `PROCESSED_PRINT_ORDERS_ROOT` or `ONYX_PROCESSED_XML_ROOT`
- `COLORADO_ACCOUNTING_ROOT` if you want to override the default
- `PRINTGUARD_PDF_HELPER_PORT` if you run the local PDF helper on a non-default port

### Paths

- `C:\PrintGuard\SubmitTool-sync`
- `C:\PrintGuard\PostPurchase`
- `C:\PrintGuard\ColoradoAccounting`
- `C:\PrintGuard\ProcessedPrintOrders-sync`
- `C:\PrintGuard\logs`
- NAS access to `\\NAS01\\Data\\ST_logs\\JobQueue` or `\\10.25.0.20\\Data\\ST_logs\\JobQueue`
- NAS access to `\\10.25.0.20\\Data\\onyx\\orders\\processed` if processed-order sync is used

### Operational notes

- Use the same Windows user for scheduled tasks that has NAS access.
- Do not leave placeholder BAT values in production runners.
- If you use the Colorado scheduled task, verify that `C:\PrintGuard\run_colorado_pipeline.bat` exists on that machine.

## 7. Local developer setup checklist

To run audit/sync scripts safely on a local PC:

1. Install Node.js and npm.
2. Clone the repo and run `npm install` in `C:\PrintGuard\print_guard_DGFC`.
3. Set only the variables required for the script you are running.

Recommended per script:

- `npm run db:audit` → `NEON_DATABASE_URL` or `DATABASE_URL`
- `npm run sync:submit-tool-logs` → `NEON_DATABASE_URL` and `SUBMIT_TOOL_LOG_ROOT`
- `npm run sync:processed-print-orders` → `PROCESSED_PRINT_ORDERS_ROOT` or `ONYX_PROCESSED_XML_ROOT`
- `node SERVER_BACKEND/script_server/colorado-upsert/upsert-colorado-json.js` → `NEON_DATABASE_URL` and optionally `COLORADO_ACCOUNTING_ROOT`
- `npm run sync:postpurchase-orders` / `node scripts/sync-postpurchase-orders.js` → `NEON_DATABASE_URL`, `POST_PURCHASE_API_BASE_URL`, `POST_PURCHASE_API_TOKEN`, plus optional `POST_PURCHASE_API_ORDERS_PATH` and `POST_PURCHASE_API_SUPPLIER_SYSTEM_CODE`

If you are only auditing configuration, keep the environment read-only and avoid starting scheduled tasks.

## 8. Missing or inconsistent config

### Mismatches and risks

- DB helpers now prefer `NEON_DATABASE_URL` first, then legacy aliases. A stale alias can still be risky if `NEON_DATABASE_URL` is missing, so scheduled jobs and Netlify should set the canonical key.
- `netlify/functions/_lib/db.js`, `server-postpurchase/lib/db.js`, `SubmitTool-sync/sync-submit-tool-logs.js`, and `SERVER_BACKEND/script_server/colorado-upsert/upsert-colorado-json.js` accept three DB aliases. That is convenient, but aliases must stay unset or aligned.
- `run-postpurchase-sync.bat` and `server-postpurchase/run-postpurchase-sync.bat` read `NEON_DATABASE_URL` from the environment and fail if it is missing.
- `run-submit-tool-sync.bat` and `run-processed-print-orders-sync.bat` are intentionally env-driven, but they will fail if the machine env is not set.
- `index.html` hardcodes the public VAPID key. That is expected, but the matching private key must stay synchronized in Netlify.
- No stale Ohio / `us-east` / `neon.tech` connection strings were found in tracked repo files.
- No hardcoded real secrets were found in tracked repo files.

### Canonical naming cleanup targets

- DB connection string: prefer `NEON_DATABASE_URL` everywhere.
- Legacy aliases to retire later: `DATABASE_URL`, `NETLIFY_DATABASE_URL`.
- Post Purchase operator alias to retire later: `POSTPURCHASE_PIN`.
- Processed-order alias to retire later: `ONYX_PROCESSED_XML_ROOT`.

## 9. Final recommended canonical env names

Recommended canonical set:

- `NEON_DATABASE_URL`
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
- `SUBMIT_TOOL_LOG_DAYS`
- `PROCESSED_PRINT_ORDERS_ROOT`
- `PROCESSED_PRINT_ORDERS_DAYS`
- `PROCESSED_PRINT_ORDERS_TIMEOUT_MS`
- `COLORADO_ACCOUNTING_ROOT`
- `PRINTGUARD_PDF_HELPER_PORT`

Legacy compatibility names to keep only as long as necessary:

- `DATABASE_URL`
- `NETLIFY_DATABASE_URL`
- `POSTPURCHASE_PIN`
- `ONYX_PROCESSED_XML_ROOT`

Long-term rule:

- One integration, one canonical env var.
- Keep compatibility aliases only during the cutover window.
- Remove the aliases after the code paths are normalized and validated.
