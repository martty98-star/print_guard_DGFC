# Neon Compute Audit

## Files that connect to Neon

- `netlify/functions/_lib/db.js`: shared `pg.Client` helper for CommonJS functions. Opens one client per invocation and closes it in `finally`.
- `netlify/functions/sync.js`: stock cloud sync endpoint. Reads/writes `pg_items`, `pg_movements`, and `pg_co_records`.
- `netlify/functions/print-log-summary.js`: print dashboard aggregates over `v_print_log_rows` and `print_accounting_rows`.
- `netlify/functions/print-log-rows.js`: paginated print-log row listing over `v_print_log_rows` and `print_accounting_rows`.
- `netlify/functions/print-log-arrivals.js`: arrival/day aggregates over `print_accounting_rows`.
- `netlify/functions/_lib/postpurchase-orders.js`: creates, lists, and upserts `print_orders_received`.
- `netlify/functions/postpurchase-orders.js`: API wrapper for Post Purchase list/sync.
- `netlify/functions/_lib/checklist-store.js`: checklist task, reminder-state, and completion tables.
- `netlify/functions/checklist-items.js`, `checklist-completions.js`, `checklist-evaluate.js`: checklist API wrappers.
- `netlify/functions/delete-stock-movement.js`: deletes one stock movement.
- `netlify/functions/save-subscription.js`, `send-stock-alerts.js`, `send-app-notification.js`, `send-test-push.js`, `_lib/push-delivery.js`: push subscription and notification state queries.
- `scripts/sync-postpurchase-orders.js`: CLI script using the shared DB helper.
- `SERVER_BACKEND/script_server/colorado-upsert/upsert-colorado-json.js`: CSV/accounting JSON importer into `print_accounting_rows` and `print_accounting_acl_files`.

## Queries likely to run often

- Frontend stock sync calls `/.netlify/functions/sync`. Before this change it ran once on app load and every 5 minutes while visible. It performs full-table reads and used per-row upserts.
- Print-log screen calls `print-log-summary`, `print-log-rows`, and `print-log-arrivals` together. These aggregate over accounting rows and can be expensive without date/printer filters and indexes.
- Push alert evaluation reads all `pg_items` and ordered `pg_movements`, then reads active subscriptions and notification state.
- Checklist list/completion endpoints run small indexed queries, but previously repeated schema DDL checks on every warm invocation.
- Post Purchase sync fetches external API pages and upserts received orders. It previously upserted each order individually.
- Colorado importer scans local normalized JSON files and previously upserted each row individually.

## Functions that may keep Neon awake

- `setupBackgroundSync()` in `app.js` was the main recurring wake source. It no longer syncs immediately on page load, only syncs while the tab is visible, and uses a 30-minute minimum interval.
- No serverless function defines a background interval.
- No persistent `Pool` is used. Existing functions create a `Client` per invocation and close it in `finally`; this is safe for Neon scale-to-zero as long as invocations are not frequent.

## Changes made

- Reduced frontend background sync from every 5 minutes to a 30-minute minimum, skipped hidden tabs, and kept manual refresh intact.
- Batched stock sync upserts in `netlify/functions/sync.js`.
- Batched Post Purchase order upserts in `netlify/functions/_lib/postpurchase-orders.js`.
- Batched Colorado accounting row and ACL metadata upserts in `SERVER_BACKEND/script_server/colorado-upsert/upsert-colorado-json.js`.
- Cached print-log column metadata per warm function instance to remove repeated `limit 0` introspection queries.
- Cached checklist and Post Purchase schema setup per warm function instance to avoid repeated DDL checks.
- Added `sql/neon-compute-indexes.sql` with indexes matched to current filters, joins, orderings, and upsert/delete keys.

## Remaining risks

- `/.netlify/functions/sync` still returns all local stock JSON blobs on pull. That preserves behavior but can be expensive as history grows.
- Print-log summary still performs heavy aggregate CTEs. The new indexes help, but the UI should keep date filters active for normal use.
- Push stock alerts still load all stock movements to compute candidates in JavaScript.
- Applying too many indexes to tiny tables is unnecessary, but the migration is focused on tables that are queried repeatedly or can grow with imports.
