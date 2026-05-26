# Graph Report - print_guard_DGFC  (2026-05-26)

## Corpus Check
- 124 files · ~119,440 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1406 nodes · 2444 edges · 88 communities (78 shown, 10 thin omitted)
- Extraction: 96% EXTRACTED · 4% INFERRED · 0% AMBIGUOUS · INFERRED: 88 edges (avg confidence: 0.8)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `53b3b123`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- [[_COMMUNITY_Community 0|Community 0]]
- [[_COMMUNITY_Community 1|Community 1]]
- [[_COMMUNITY_Community 2|Community 2]]
- [[_COMMUNITY_Community 3|Community 3]]
- [[_COMMUNITY_Community 4|Community 4]]
- [[_COMMUNITY_Community 5|Community 5]]
- [[_COMMUNITY_Community 6|Community 6]]
- [[_COMMUNITY_Community 7|Community 7]]
- [[_COMMUNITY_Community 8|Community 8]]
- [[_COMMUNITY_Community 9|Community 9]]
- [[_COMMUNITY_Community 10|Community 10]]
- [[_COMMUNITY_Community 11|Community 11]]
- [[_COMMUNITY_Community 12|Community 12]]
- [[_COMMUNITY_Community 13|Community 13]]
- [[_COMMUNITY_Community 14|Community 14]]
- [[_COMMUNITY_Community 15|Community 15]]
- [[_COMMUNITY_Community 16|Community 16]]
- [[_COMMUNITY_Community 17|Community 17]]
- [[_COMMUNITY_Community 18|Community 18]]
- [[_COMMUNITY_Community 19|Community 19]]
- [[_COMMUNITY_Community 20|Community 20]]
- [[_COMMUNITY_Community 21|Community 21]]
- [[_COMMUNITY_Community 22|Community 22]]
- [[_COMMUNITY_Community 23|Community 23]]
- [[_COMMUNITY_Community 24|Community 24]]
- [[_COMMUNITY_Community 25|Community 25]]
- [[_COMMUNITY_Community 26|Community 26]]
- [[_COMMUNITY_Community 27|Community 27]]
- [[_COMMUNITY_Community 28|Community 28]]
- [[_COMMUNITY_Community 29|Community 29]]
- [[_COMMUNITY_Community 30|Community 30]]
- [[_COMMUNITY_Community 31|Community 31]]
- [[_COMMUNITY_Community 32|Community 32]]
- [[_COMMUNITY_Community 33|Community 33]]
- [[_COMMUNITY_Community 34|Community 34]]
- [[_COMMUNITY_Community 35|Community 35]]
- [[_COMMUNITY_Community 36|Community 36]]
- [[_COMMUNITY_Community 37|Community 37]]
- [[_COMMUNITY_Community 38|Community 38]]
- [[_COMMUNITY_Community 39|Community 39]]
- [[_COMMUNITY_Community 40|Community 40]]
- [[_COMMUNITY_Community 41|Community 41]]
- [[_COMMUNITY_Community 42|Community 42]]
- [[_COMMUNITY_Community 43|Community 43]]
- [[_COMMUNITY_Community 44|Community 44]]
- [[_COMMUNITY_Community 45|Community 45]]
- [[_COMMUNITY_Community 46|Community 46]]
- [[_COMMUNITY_Community 47|Community 47]]
- [[_COMMUNITY_Community 48|Community 48]]
- [[_COMMUNITY_Community 49|Community 49]]
- [[_COMMUNITY_Community 50|Community 50]]
- [[_COMMUNITY_Community 51|Community 51]]
- [[_COMMUNITY_Community 52|Community 52]]
- [[_COMMUNITY_Community 53|Community 53]]
- [[_COMMUNITY_Community 54|Community 54]]
- [[_COMMUNITY_Community 55|Community 55]]
- [[_COMMUNITY_Community 56|Community 56]]
- [[_COMMUNITY_Community 57|Community 57]]
- [[_COMMUNITY_Community 58|Community 58]]
- [[_COMMUNITY_Community 59|Community 59]]
- [[_COMMUNITY_Community 60|Community 60]]
- [[_COMMUNITY_Community 61|Community 61]]
- [[_COMMUNITY_Community 62|Community 62]]
- [[_COMMUNITY_Community 63|Community 63]]
- [[_COMMUNITY_Community 64|Community 64]]
- [[_COMMUNITY_Community 65|Community 65]]
- [[_COMMUNITY_Community 66|Community 66]]
- [[_COMMUNITY_Community 67|Community 67]]
- [[_COMMUNITY_Community 68|Community 68]]
- [[_COMMUNITY_Community 75|Community 75]]
- [[_COMMUNITY_Community 78|Community 78]]
- [[_COMMUNITY_Community 79|Community 79]]
- [[_COMMUNITY_Community 81|Community 81]]
- [[_COMMUNITY_Community 82|Community 82]]
- [[_COMMUNITY_Community 83|Community 83]]
- [[_COMMUNITY_Community 84|Community 84]]
- [[_COMMUNITY_Community 85|Community 85]]
- [[_COMMUNITY_Community 86|Community 86]]
- [[_COMMUNITY_Community 87|Community 87]]

## God Nodes (most connected - your core abstractions)
1. `el()` - 26 edges
2. `PrintLogRow` - 25 edges
3. `buildOrderPipelineFilters()` - 15 edges
4. `fetchPostPurchaseOrders()` - 15 edges
5. `ensureProcessedPrintOrderTables()` - 15 edges
6. `normalizeOrderType()` - 14 edges
7. `listOrderPipeline()` - 14 edges
8. `cleanString()` - 14 edges
9. `fetchPostPurchaseOrders()` - 14 edges
10. `showToast()` - 13 edges

## Surprising Connections (you probably didn't know these)
- `openStockDetail()` --calls--> `fmtDays()`  [INFERRED]
  app.js → scripts/core-utils.js
- `Post Purchase Sync Script` --references--> `Neon PostgreSQL`  [EXTRACTED]
  scripts/sync-postpurchase-orders.js → README.md
- `Processed Orders Sync Script` --references--> `Neon PostgreSQL`  [EXTRACTED]
  scripts/sync-processed-print-orders.js → README.md
- `Colorado JSON Upsert` --references--> `Neon PostgreSQL`  [EXTRACTED]
  SERVER_BACKEND/script_server/colorado-upsert/upsert-colorado-json.js → README.md
- `Netlify DB Helper` --references--> `Neon PostgreSQL`  [EXTRACTED]
  netlify/functions/_lib/db.js → README.md

## Communities (88 total, 10 thin omitted)

### Community 0 - "Community 0"
Cohesion: 0.07
Nodes (65): processed_print_orders, { evaluateChecklistReminders }, { json, parseRequestBody, requireAdminAccess, withClient }, lookbackMinutes, { json, parseRequestBody, requireAdminPin, withClient }, {
  buildDailyProductionReport,
}, {
  checkRateLimit,
  json,
  requirePostPurchaseAccess,
  withClient,
}, id (+57 more)

### Community 1 - "Community 1"
Cohesion: 0.10
Nodes (59): {
  checkRateLimit,
  json,
  requirePostPurchaseAccess,
  withClient,
}, cleanApiError(), cleanString(), detailStarted, filters, {
  getOrderPipelineDetail,
  getOrderPipelineStats,
  listOrderPipeline,
  listPipelineMonths,
}, includeStats, months (+51 more)

### Community 2 - "Community 2"
Cohesion: 0.10
Nodes (49): ChecklistItem, ChecklistItemInput, ChecklistOccurrence, ChecklistScheduleType, ChecklistWeekdayKey, DueEvaluationOptions, getVisibleChecklistOccurrence(), addChecklistLocalDays() (+41 more)

### Community 3 - "Community 3"
Cohesion: 0.08
Nodes (35): api, bucketFillPercent(), bucketRemainingState(), buildColoradoIntervals(), buildColoradoMonthlySummary(), buildColoradoRollSummary(), buildColoradoStats(), DEFAULT_MACHINES (+27 more)

### Community 4 - "Community 4"
Cohesion: 0.07
Nodes (36): chunkArray(), { Client }, ensureAclTable(), fs, getAclJsonFiles(), getAclRowValues(), getJsonFiles(), getRowValues() (+28 more)

### Community 5 - "Community 5"
Cohesion: 0.08
Nodes (43): crypto, ensureLifecycleEventsTable(), { ensurePrintOrdersTable }, findMatchingOrder(), formatDateFolder(), fs, getDateFolders(), getMatchCandidates() (+35 more)

### Community 6 - "Community 6"
Cohesion: 0.11
Nodes (36): normalizeOrderType(), { Client }, getConnectionString(), withClient(), applyFilterParams(), assertPostPurchaseConfig(), buildCandidateUrls(), cleanString() (+28 more)

### Community 7 - "Community 7"
Cohesion: 0.12
Nodes (36): chunkArray(), listPrintOrdersReceived(), mapPrintOrderRow(), updatePrintOrderLifecycleStatus(), applyFilterParams(), assertPostPurchaseConfig(), buildCandidateUrls(), cleanString() (+28 more)

### Community 8 - "Community 8"
Cohesion: 0.12
Nodes (33): buildAccountingInkExpressions(), buildAccountingInkJoin(), buildDurationValueExpr(), buildFilters(), buildInkChannelPresenceExpr(), buildInkExpressions(), buildInkPresenceExpr(), buildLogicalJobExpr() (+25 more)

### Community 9 - "Community 9"
Cohesion: 0.11
Nodes (30): appendScanLine(), cleanBarcode(), cleanRawBarcode(), contentTypeFor(), crypto, ensureFallbackDir(), ensureOutputDir(), fileDateFromIso() (+22 more)

### Community 10 - "Community 10"
Cohesion: 0.12
Nodes (27): formatPipelineDateTime(), getAttentionPriority(), getAttentionState(), getFileHistory(), getPipelineAgeMinutes(), getPrimaryOrderLabel(), getReprintActionState(), getReprintKey() (+19 more)

### Community 11 - "Community 11"
Cohesion: 0.06
Nodes (22): PWA Shell, adminAuth, buildMovementRows(), buildStockHistoryTable(), CO_FORMATS, Colorado, computeStock(), costCurrencySelect (+14 more)

### Community 12 - "Community 12"
Cohesion: 0.08
Nodes (22): activeStateByKey, candidateKeys, candidates, { Client }, existing, getStatusCode(), items, movements (+14 more)

### Community 13 - "Community 13"
Cohesion: 0.12
Nodes (15): buildAccountingInkExpressions(), buildAccountingInkJoin(), buildFilters(), buildInkExpressions(), columnCache, getColumns(), getColumnsSafe(), handler() (+7 more)

### Community 14 - "Community 14"
Cohesion: 0.14
Nodes (28): adjustStatsAfterReprintResolve(), bindProcessedOrderActions(), buildOrderPipelineFilters(), cleanApiError(), createReprintRequest(), deleteReprintRequest(), findOrderAndPrintFile(), getActiveFilterLabel() (+20 more)

### Community 15 - "Community 15"
Cohesion: 0.05
Nodes (55): checklistId, checklistTitle, {
  completeChecklistOccurrence,
  listChecklistCompletions,
}, completedAt, completedBy, deviceId, { json, parseRequestBody, withClient }, limit (+47 more)

### Community 16 - "Community 16"
Cohesion: 0.09
Nodes (37): dependencies, pg, web-push, name, private, scripts, db:audit, db:indexes (+29 more)

### Community 17 - "Community 17"
Cohesion: 0.21
Nodes (19): buildDailyProductionReport(), buildEmail(), buildWarnings(), cleanDate(), escapeHtml(), fmtNumber(), int(), loadMachineOutput() (+11 more)

### Community 18 - "Community 18"
Cohesion: 0.06
Nodes (35): 1. Copy files, 2. Install Node dependencies, 3. Set machine environment variables, 4. NAS access rule, 5. Manual test, 6. Install scheduled task, 7. What this sync does, 8. Troubleshooting (+27 more)

### Community 19 - "Community 19"
Cohesion: 0.18
Nodes (17): deleteCoRecord(), deleteItem(), deleteMovementAdmin(), openItemModal(), renderPostPurchaseAccessRequired(), requireAdminPinForScreen(), requirePostPurchasePinForScreen(), showConfirm() (+9 more)

### Community 20 - "Community 20"
Cohesion: 0.17
Nodes (9): buildLogEntries(), escapeHtml(), getCurrentLocalDateKey(), getFilterLabel(), getFilterRange(), renderChecklistList(), renderChecklistLog(), renderChecklistScreen() (+1 more)

### Community 21 - "Community 21"
Cohesion: 0.26
Nodes (16): batchUpsertCoRecords(), batchUpsertItems(), batchUpsertMovements(), checkAdminApiKey(), checkAdminPin(), checkRateLimit(), chunkArray(), getAdminApiKey() (+8 more)

### Community 22 - "Community 22"
Cohesion: 0.16
Nodes (11): ds(), fmtDays(), fmtDuration(), fmtInt(), fmtMeasure(), fmtN(), getPrintLogTodayQueueBasisLabel(), printLogRangeLabel() (+3 more)

### Community 23 - "Community 23"
Cohesion: 0.14
Nodes (5): api, filterStockOverviewItems(), getActiveStockItems(), getAlertStockItems(), getStockStatusCounts()

### Community 24 - "Community 24"
Cohesion: 0.06
Nodes (32): 1) Stock / inventory sync, 2) Post Purchase orders, 3) Processed orders, 4) Order pipeline, 5) Checklist, 6) Submit Tool lifecycle sync, 7) Colorado pipeline, 8) Push notifications (+24 more)

### Community 25 - "Community 25"
Cohesion: 0.14
Nodes (7): { Client }, errorBody, failures, payload, statusCode, subscription, webPush

### Community 26 - "Community 26"
Cohesion: 0.21
Nodes (11): buildMarkdown(), { Client }, fail(), fs, groupPrimaryKeys(), main(), markdownTable(), outputPath (+3 more)

### Community 27 - "Community 27"
Cohesion: 0.15
Nodes (13): Post Purchase Sync, print_orders_received, Scan Capture Server, v_print_order_pipeline, Database Schema Audit, Neon PostgreSQL, Netlify DB Helper, Post Purchase API (+5 more)

### Community 28 - "Community 28"
Cohesion: 0.15
Nodes (12): author, dependencies, pg, description, keywords, license, main, name (+4 more)

### Community 29 - "Community 29"
Cohesion: 0.15
Nodes (12): background_color, description, display, icons, lang, name, orientation, scope (+4 more)

### Community 30 - "Community 30"
Cohesion: 0.08
Nodes (22): API, code:bat (cd scan-capture), code:bat (scan-capture\run-scan-capture.bat), code:powershell (New-NetFirewallRule -DisplayName "PrintGuard Scan Capture 17), code:powershell (Test-Path "\\NAS01\Data\PrintGuard\scans"), code:powershell ([Environment]::GetEnvironmentVariable("PRINTGUARD_SCAN_OUTPU), code:json ({), code:json ({) (+14 more)

### Community 31 - "Community 31"
Cohesion: 0.18
Nodes (7): { Client }, matchedSubscriptions, normalizeAlertTypes(), notificationPayload, statusCode, subscriptionMatchesCategory(), webPush

### Community 32 - "Community 32"
Cohesion: 0.35
Nodes (11): api, buildColoradoRecordCreatedEvent(), buildStockCriticalAlertEvent(), buildStockMovementCreatedEvent(), buildStockZeroAlertEvent(), createEvent(), EVENT_TYPES, formatTimestamp() (+3 more)

### Community 33 - "Community 33"
Cohesion: 0.35
Nodes (11): closeModal(), copyText(), errorMessage(), esc(), initDailyReportUI(), loadAndShowReport(), mailtoHref(), renderModal() (+3 more)

### Community 35 - "Community 35"
Cohesion: 0.22
Nodes (4): columnCache, handler(), resp(), withClient()

### Community 36 - "Community 36"
Cohesion: 0.35
Nodes (10): Contains-Value(), Convert-ResponseContentToString(), Download-File(), Ensure-Folder(), Get-AbsoluteUrl(), Get-DownloadLinksFromHtml(), Load-Manifest(), Save-Manifest() (+2 more)

### Community 37 - "Community 37"
Cohesion: 0.14
Nodes (11): idbPut(), openDB(), setDb(), saveSettingsToIDB(), setupAppUpdateChecks(), showPendingUpdateToast(), init(), loadColoradoRollEvents() (+3 more)

### Community 38 - "Community 38"
Cohesion: 0.29
Nodes (11): computeCoIntervals(), computeCoStats(), getCoRecs(), getCostUnitPerM2(), getCostUnitPerMonth(), getLatestCoRecord(), i18n(), renderCoHistory() (+3 more)

### Community 39 - "Community 39"
Cohesion: 0.27
Nodes (11): idbAll(), loadSettingsFromIDB(), loadAll(), renderAlerts(), renderCoDashboard(), renderItemsMgmt(), renderStockOverview(), saveItemModal() (+3 more)

### Community 40 - "Community 40"
Cohesion: 0.33
Nodes (8): api, buildPrintErrorSummary(), buildPrintLifecycleGroups(), buildPrintLogSummary(), derivePrintLifecycleStatus(), normalizePrintLogResult(), normalizePrintLogSourceFile(), normalizePrintLogText()

### Community 41 - "Community 41"
Cohesion: 0.31
Nodes (7): api, buildStockLogRows(), buildStockMovementLedger(), buildStockSummary(), getMovementsForItem(), normalizeMovType(), sortByTimestampAsc()

### Community 42 - "Community 42"
Cohesion: 0.31
Nodes (6): computeStock(), getMovements(), renderStockAlerts(), renderStockHistory(), renderStockOverview(), requireContext()

### Community 43 - "Community 43"
Cohesion: 0.20
Nodes (4): deleteMovement(), api, deleteMovementLocal(), deleteMovementsForArticle()

### Community 44 - "Community 44"
Cohesion: 0.31
Nodes (6): adminHeaders(), adminJsonHeaders(), getAdminPinForRequest(), getPostPurchasePinForRequest(), postPurchaseHeaders(), postPurchaseJsonHeaders()

### Community 45 - "Community 45"
Cohesion: 0.22
Nodes (3): { Client }, deviceName, userLabel

### Community 46 - "Community 46"
Cohesion: 0.22
Nodes (4): http, PORT, server, { spawn }

### Community 47 - "Community 47"
Cohesion: 0.22
Nodes (8): dependencies, pg, description, name, private, scripts, sync, version

### Community 48 - "Community 48"
Cohesion: 0.12
Nodes (15): 1. Required environment variables, 2. Secret inventory, 3. Runtime paths, 4. Scheduled jobs / cron, 5. Netlify setup checklist, 6. Print server setup checklist, 7. Local developer setup checklist, 8. Missing or inconsistent config (+7 more)

### Community 49 - "Community 49"
Cohesion: 0.46
Nodes (7): api, dispatchNotificationEvent(), emitColoradoRecordCreated(), emitStockMovementCreated(), evaluateStockAlerts(), getNotificationModel(), postJson()

### Community 50 - "Community 50"
Cohesion: 0.39
Nodes (6): api, buildColoradoRecordNotification(), buildStockMovementNotification(), formatTimestamp(), getMovementTypeLabel(), normalizeText()

### Community 51 - "Community 51"
Cohesion: 0.43
Nodes (5): bindChecklistEvents(), closeForm(), fillForm(), openForm(), WEEKDAY_OPTIONS

### Community 52 - "Community 52"
Cohesion: 0.39
Nodes (5): cleanString(), filterRows(), getFiltersFromState(), getSearchFromState(), normalizeSearchTerm()

### Community 53 - "Community 53"
Cohesion: 0.25
Nodes (7): dependencies, pg, name, private, scripts, sync, version

### Community 55 - "Community 55"
Cohesion: 0.38
Nodes (6): { Client }, getConnectionString(), main(), safeConnectionTarget(), TABLES, VIEWS

### Community 56 - "Community 56"
Cohesion: 0.44
Nodes (7): cleanValue(), escXml(), fileNameFromPath(), generateReprintXml(), normalizePoNumber(), pickOriginalOrderId(), xmlDocument()

### Community 57 - "Community 57"
Cohesion: 0.24
Nodes (9): getSelectedMachine(), saveCoEntry(), updateCoPreview(), toISOfromDT(), buildPushSubscriptionPayload(), getPushDeviceName(), getPushEndpointSuffix(), persistPushSubscription() (+1 more)

### Community 58 - "Community 58"
Cohesion: 0.52
Nodes (6): close(), open(), reasonLabel(), REPRINT_REASONS, submit(), t()

### Community 59 - "Community 59"
Cohesion: 0.25
Nodes (7): Columns, Database Schema Audit, Foreign Keys, Indexes, Primary Keys, Tables, Views

### Community 60 - "Community 60"
Cohesion: 0.40
Nodes (4): buildMovementRows(), buildStockHistoryTable(), movementLabel(), renderAlerts()

### Community 61 - "Community 61"
Cohesion: 0.33
Nodes (3): payload, responseClone, url

### Community 62 - "Community 62"
Cohesion: 0.50
Nodes (3): applyTheme(), cfg, normalizeTheme()

### Community 63 - "Community 63"
Cohesion: 0.60
Nodes (4): { Client }, getConnectionString(), getRecordId(), main()

### Community 64 - "Community 64"
Cohesion: 0.70
Nodes (4): buildDailyReportUrl(), loadDailyReport(), readJsonResponse(), t()

### Community 65 - "Community 65"
Cohesion: 0.40
Nodes (4): file, fs, parsed, raw

### Community 68 - "Community 68"
Cohesion: 0.67
Nodes (3): Neon PostgreSQL, Netlify Functions, app/sync.js

### Community 75 - "Community 75"
Cohesion: 0.11
Nodes (18): Configuration Inventory, Admin API authentication, Canonical configuration, code:text (NEON_DATABASE_URL -> DATABASE_URL -> NETLIFY_DATABASE_URL), code:bash (ADMIN_API_KEY=long_random_server_key), code:bash (node scripts/sync-postpurchase-orders.js), code:bash (SUBMIT_TOOL_LOG_ROOT=\\10.25.0.20\Data\ST_logs\JobQueue), code:bash (node scripts/sync-submit-tool-logs.js --days=2) (+10 more)

### Community 82 - "Community 82"
Cohesion: 0.25
Nodes (7): code:powershell (npm install), code:powershell (.\run-postpurchase-sync.bat), Contents, Notes, Post Purchase Server Sync, Scheduler, Server setup

### Community 83 - "Community 83"
Cohesion: 0.29
Nodes (6): Changes already made, Files that connect to Neon, Functions that may keep Neon awake, Neon Compute Audit, Queries likely to run often, Remaining risks

### Community 85 - "Community 85"
Cohesion: 0.83
Nodes (3): copyText(), openPdfPath(), uncToFileHref()

## Knowledge Gaps
- **316 isolated node(s):** `S`, `Colorado`, `printLogApi`, `pushApi`, `syncApi` (+311 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **10 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `scripts` connect `Community 16` to `Community 3`, `Community 5`, `Community 7`?**
  _High betweenness centrality (0.056) - this node is a cross-community bridge._
- **Why does `log()` connect `Community 4` to `Community 6`, `Community 7`?**
  _High betweenness centrality (0.040) - this node is a cross-community bridge._
- **Are the 23 inferred relationships involving `el()` (e.g. with `requireAdminPinForScreen()` and `renderPostPurchaseAccessRequired()`) actually correct?**
  _`el()` has 23 INFERRED edges - model-reasoned connections that need verification._
- **What connects `S`, `Colorado`, `printLogApi` to the rest of the system?**
  _317 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Community 0` be split into smaller, more focused modules?**
  _Cohesion score 0.0656140350877193 - nodes in this community are weakly interconnected._
- **Should `Community 1` be split into smaller, more focused modules?**
  _Cohesion score 0.09994711792702274 - nodes in this community are weakly interconnected._
- **Should `Community 2` be split into smaller, more focused modules?**
  _Cohesion score 0.09728506787330317 - nodes in this community are weakly interconnected._