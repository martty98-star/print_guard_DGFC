# PrintGuard Scan Capture

Minimal local scan capture for barcode scanners that behave like keyboards.

Flow:

`scanner / operator PC -> local browser page -> local Node server -> NAS JSONL -> operator commit -> Neon`

`POST /scan` does **not** write to Neon. It only appends scan events to a shared folder.

Neon writes happen only after the operator clicks **Hotovo / Odeslat do PrintGuardu** in the scan page, which calls `POST /commit-scans`.

## Configuration

### Environment variables

- `PRINTGUARD_SCAN_CAPTURE_PORT`
  - default: `17910`
  - port for the local Node capture server

- `PRINTGUARD_SCAN_HOST`
  - default: `127.0.0.1`
  - host/interface for the local Node capture server
  - keep it on loopback when Caddy is the public HTTPS entrypoint

- `PRINTGUARD_SCAN_OUTPUT_DIR`
  - default: `C:\PrintGuard\Scans`
  - primary JSONL output folder
  - production value should point to the NAS share, for example:
    - `\\NAS01\Data\PrintGuard\scans`
    - `\\10.25.0.20\Data\PrintGuard\scans`

- `PRINTGUARD_SCAN_INPUT_DIR`
  - default: same as `PRINTGUARD_SCAN_OUTPUT_DIR`
  - intended for the next print-server ingest script so capture and ingest can be decoupled cleanly

- `PRINTGUARD_SCAN_FALLBACK_DIR`
  - default: `C:\PrintGuard\ScansFallback`
  - local append-only fallback when the NAS write fails

- `NEON_DATABASE_URL`
  - required only for `GET /pending-scans` and `POST /commit-scans`
  - server-side only; never expose it to the browser
  - legacy aliases `DATABASE_URL` and `NETLIFY_DATABASE_URL` also work if aligned with `NEON_DATABASE_URL`

- `PRINTGUARD_PDF_ROOT`
  - default: `\\NAS01\Data\onyx\prints`
  - used by `GET /pdf-open` on the print server
  - only PDFs under this root are served

## JSONL files

One file per day:

`job-label-scans-YYYY-MM-DD.jsonl`

Example NAS path:

`\\NAS01\Data\PrintGuard\scans\job-label-scans-2026-05-20.jsonl`

If the NAS write fails, the server appends the same event to:

`C:\PrintGuard\ScansFallback\failed-scans-YYYY-MM-DD.jsonl`

## Run

From the repo root:

```bat
cd scan-capture
node server.js
```

Or:

```bat
scan-capture\run-scan-capture.bat
```

That batch file sets:

- `PRINTGUARD_SCAN_HOST=127.0.0.1`
- `PRINTGUARD_SCAN_CAPTURE_PORT=17910`
- `PRINTGUARD_SCAN_OUTPUT_DIR=\\NAS01\Data\PrintGuard\scans`
- `PRINTGUARD_SCAN_INPUT_DIR=\\NAS01\Data\PrintGuard\scans`
- `PRINTGUARD_SCAN_FALLBACK_DIR=C:\PrintGuard\ScansFallback`

Start the server on the print server. For the HTTPS deployment behind Caddy, use:

`https://printguard-scan.desenio.cz`

Health check:

`https://printguard-scan.desenio.cz/health`

PDF proxy:

`https://printguard-scan.desenio.cz/pdf-open?orderName=PS123456&fileIndex=0`

If you need direct LAN access without Caddy for a temporary test only, set `PRINTGUARD_SCAN_HOST=0.0.0.0` before starting Node and use:

`http://10.25.0.15:17910`

## Caddy HTTPS reverse proxy

Use Caddy as the only user-facing endpoint for the scan UI. The Node server stays on loopback and keeps port `17910`.

`scan-capture/Caddyfile`:

```caddyfile
printguard-scan.desenio.cz {
  tls internal
  reverse_proxy 127.0.0.1:17910
}
```

Recommended rollout on the print server:

1. Start the Node server with `PRINTGUARD_SCAN_HOST=127.0.0.1`.
2. Install Caddy and load `scan-capture/Caddyfile`.
3. Open inbound firewall ports `80` and `443`.
4. Ensure name resolution for `printguard-scan.desenio.cz` points to `10.25.0.15`.
5. Trust Caddy's internal root CA on each operator PC before testing PWA installability.

Firewall rules for Caddy:

```powershell
New-NetFirewallRule -DisplayName "PrintGuard Scan Capture HTTP" -Direction Inbound -Protocol TCP -LocalPort 80 -Action Allow
New-NetFirewallRule -DisplayName "PrintGuard Scan Capture HTTPS" -Direction Inbound -Protocol TCP -LocalPort 443 -Action Allow
```

DNS or hosts mapping example:

```text
10.25.0.15 printguard-scan.desenio.cz
```

Windows hosts file path:

```text
C:\Windows\System32\drivers\etc\hosts
```

Export Caddy's internal root certificate on the print server:

```powershell
caddy trust
```

If operator PCs do not have Caddy installed, copy the root CA certificate from Caddy's data directory and import it into `Trusted Root Certification Authorities` on each PC.

Typical Windows path:

```text
%AppData%\Caddy\pki\authorities\local\root.crt
```

Import on an operator PC:

```powershell
Import-Certificate -FilePath "C:\path\to\root.crt" -CertStoreLocation Cert:\LocalMachine\Root
```

Verification checklist:

```powershell
Invoke-WebRequest https://printguard-scan.desenio.cz/health | Select-Object -ExpandProperty Content
Invoke-WebRequest https://printguard-scan.desenio.cz/manifest.webmanifest | Select-Object -ExpandProperty Content
```

Browser checks:

- `https://printguard-scan.desenio.cz/health` returns JSON with `"ok": true`
- the page loads with a secure lock indicator
- `manifest.webmanifest` loads without mixed-content errors
- the service worker registers successfully
- the browser offers PWA install when local policy/browser support allows it

## Windows PowerShell examples

Check NAS folder:

```powershell
Test-Path "\\NAS01\Data\PrintGuard\scans"
```

Set machine env:

```powershell
[Environment]::SetEnvironmentVariable(
  "PRINTGUARD_SCAN_OUTPUT_DIR",
  "\\NAS01\Data\PrintGuard\scans",
  "Machine"
)
```

Verify env:

```powershell
[Environment]::GetEnvironmentVariable("PRINTGUARD_SCAN_OUTPUT_DIR","Machine")
```

## Required NAS permissions

The account running the scan capture server needs:

- read/write/create on the NAS scan folder
- write/create on the fallback folder if the NAS is unavailable locally

If the share is unreachable or permissions are wrong, the UI shows an error and the scan is still written to the local fallback queue.

## API

### `POST /scan`

Request:

```json
{
  "barcode": "PS4768388",
  "rawBarcode": "PS4768388",
  "operator": "Daniel",
  "station": "SRV05-PRINT"
}
```

Stored JSONL line:

```json
{
  "scanId": "8dca9c30-6c03-4b4e-93df-0a9d652fb72e",
  "scannedAt": "2026-05-20T10:30:00.000Z",
  "barcode": "PS4768388",
  "rawBarcode": "PS4768388",
  "orderNumber": "PS4768388",
  "station": "SRV05-PRINT",
  "operator": "Daniel",
  "source": "job_label_scan"
}
```

### `GET /recent?count=10`

Returns recent scans from the active output folder plus the configured directories.

### `GET /pending-scans`

Reads JSONL files from `PRINTGUARD_SCAN_INPUT_DIR` and the fallback folder, then checks Neon for existing `print_job_label_scans.scan_id` rows.

Response includes:

- `pendingCount`
- `latestPendingScan`
- `latestScan`
- `duplicateLines`
- `invalidJsonLines`
- `invalidScanLines`

Already committed scan IDs are not counted as pending.

### `POST /commit-scans`

Request:

```json
{
  "committedBy": "Daniel",
  "station": "SRV05-PRINT"
}
```

Behavior:

- reads append-only JSONL files from `PRINTGUARD_SCAN_INPUT_DIR`
- also reads `PRINTGUARD_SCAN_FALLBACK_DIR` when configured
- ignores invalid JSON lines but counts them in the summary
- dedupes repeated `scanId` values
- skips scan IDs already present in `public.print_job_label_scans`
- creates one `public.print_scan_commit_batches` row
- inserts new scan rows into `public.print_job_label_scans`
- matches `orderNumber` / `barcode` against `public.processed_print_orders.order_name`
- when exactly one processed order matches, fills `processed_print_orders.physically_printed_*`
- never deletes or truncates JSONL files

Response summary:

```json
{
  "ok": true,
  "batchId": "scan-batch-20260528123000-...",
  "totalScansRead": 42,
  "newScansCommitted": 40,
  "matchedCount": 38,
  "unmatchedCount": 2,
  "ambiguousCount": 0,
  "duplicateCount": 2,
  "errorCount": 0
}
```

### `DELETE /scan?scanId=...&scannedAt=...`

Appends a `job_label_scan_delete` cancellation marker for one scan. It does not rewrite, truncate, or delete JSONL source files.

The UI uses this for operator cleanup before commit. `GET /pending-scans` and `POST /commit-scans` ignore scans that have a cancellation marker.

## Validation rules

- barcode is trimmed
- empty barcode is rejected
- barcode longer than 200 chars is rejected
- `rawBarcode` preserves the original scanned text
- `orderNumber` is derived from the trimmed barcode without inventing a `PS` prefix
- operator and station are sanitized and length-limited
- barcode is never executed or interpreted as a command
- fetches use same-origin when the HTML is served by the Node server
- the page has no API base field; it always talks to the same origin
- records can be deleted from the recent list when somebody scans something wrong

## Failure behavior

- NAS write succeeds:
  - scan is appended to `PRINTGUARD_SCAN_OUTPUT_DIR`
  - UI shows success

- NAS write fails:
  - scan is appended to the local fallback queue
  - UI shows a visible error
  - scan is not lost silently

## Operator commit

The commit endpoint reads from:

`PRINTGUARD_SCAN_INPUT_DIR`

Default: same as `PRINTGUARD_SCAN_OUTPUT_DIR`

That lets you keep:

- capture station writing to NAS
- operator review in the scan-capture UI
- explicit batch commit to Neon only after **Hotovo**
- source JSONL files append-only for audit/replay

## SQL verification

Apply the migration:

```sql
\i sql/print-job-label-scans.sql
```

Useful checks are stored in:

```sql
\i sql/print-job-label-scans-verification.sql
```

The verification script includes:

- latest committed scans
- unmatched or ambiguous scans
- processed orders marked physically printed
- latest commit batches

## Notes

- Files are append-only, including operator cleanup actions.
- Old JSONL files are never deleted.
- The capture tool is intentionally standalone.
