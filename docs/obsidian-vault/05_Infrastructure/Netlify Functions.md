# Netlify Functions

## Role
Netlify Functions are the HTTP boundary between the browser runtime and Neon. They expose order-pipeline, processed-orders, checklist, print-log, sync, push, and reporting endpoints, while shared DB and domain helpers live under `netlify/functions/_lib/`. They also host the canonical backend logic for Post Purchase ingestion and order-pipeline shaping.

## Connected to
- [[PrintGuard Core]]
- [[Order Pipeline]]
- [[PostPurchase API]]
- [[Neon Database]]
- [[Admin Auth]]
- [[Stock System]]
- [[Processed XML]]
- [[Reprint Logic]]
- [[Performance Bottlenecks]]
