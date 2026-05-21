# PrintGuard Scan Capture

Minimal local scan capture for barcode scanners that behave like keyboards.

Flow:

`scanner / operator PC -> local browser page -> local Node server -> NAS JSONL`

This tool does **not** write to Neon. It only appends scan events to a shared folder that the print server can read later.

## Configuration

### Environment variables

- `PRINTGUARD_SCAN_CAPTURE_PORT`
  - default: `17910`
  - port for the local Node capture server

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

- `PRINTGUARD_SCAN_HOST=0.0.0.0`
- `PRINTGUARD_SCAN_CAPTURE_PORT=17910`
- `PRINTGUARD_SCAN_OUTPUT_DIR=\\NAS01\Data\PrintGuard\scans`
- `PRINTGUARD_SCAN_INPUT_DIR=\\NAS01\Data\PrintGuard\scans`
- `PRINTGUARD_SCAN_FALLBACK_DIR=C:\PrintGuard\ScansFallback`

Start the server on the print server, then open from an operator PC:

`http://10.25.0.15:17910`

Health check:

`http://10.25.0.15:17910/health`

Firewall rule:

```powershell
New-NetFirewallRule -DisplayName "PrintGuard Scan Capture 17910" -Direction Inbound -Protocol TCP -LocalPort 17910 -Action Allow
```

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

### `DELETE /scan?scanId=...&scannedAt=...`

Deletes one scan record from the daily JSONL file. The UI uses this for operator cleanup.

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

## Print server ingest

The next ingest script should read from:

`PRINTGUARD_SCAN_INPUT_DIR`

Default: same as `PRINTGUARD_SCAN_OUTPUT_DIR`

That lets you keep:

- capture station writing to NAS
- print server reading from the same NAS folder

## Notes

- Files are append-only.
- Old JSONL files are never deleted.
- The capture tool is intentionally standalone.
