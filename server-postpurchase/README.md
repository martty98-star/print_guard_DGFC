# Post Purchase Server Sync

Minimal standalone package for syncing Post Purchase orders from the API into Neon/Postgres on a Windows print server.

## Contents

- `package.json`
- `sync-postpurchase-orders.js`
- `lib/db.js`
- `lib/postpurchase-orders.js`
- `run-postpurchase-sync.bat`

## Server setup

1. Copy the whole `server-postpurchase` folder to the server, for example:
   `C:\PrintGuard\PostPurchase`
2. Install Node.js if it is not installed yet.
3. Open PowerShell in that folder and run:

```powershell
npm install
```

4. Edit `run-postpurchase-sync.bat` and fill in:
   - `POST_PURCHASE_API_TOKEN`
   - `NEON_DATABASE_URL`
   - optionally `POST_PURCHASE_API_ORDERS_PATH`

5. Run a manual test:

```powershell
.\run-postpurchase-sync.bat
```

## Scheduler

Windows Task Scheduler:

- Program/script: `C:\PrintGuard\PostPurchase\run-postpurchase-sync.bat`

## Notes

- `POST_PURCHASE_API_BASE_URL` should stay as `https://post-purchase.desen.io`
- `POST_PURCHASE_API_SUPPLIER_SYSTEM_CODE` should stay as `desenio_dgfc_printer`
- Leave `POST_PURCHASE_API_ORDERS_PATH` commented out unless autodiscovery fails
