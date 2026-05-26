# PrintGuard Core

## Role
PrintGuard is an offline-first browser PWA for print operations. The frontend is still classic-script vanilla JavaScript loaded from `index.html`, with `app.js` acting as the composition root while logic is being split into modules under `app/`, `scripts/`, and `reports/`. Its main live business flow is order intake from Post Purchase, processed XML import from the print side, reconciliation in the order pipeline, and operator handling of reprints.

## Connected to
- [[Operational Workflow]]
- [[Netlify Functions]]
- [[Neon Database]]
- [[Stock System]]
- [[Order Pipeline]]
- [[Admin Auth]]
- [[PostPurchase API]]
- [[Processed XML]]
- [[Performance Bottlenecks]]
