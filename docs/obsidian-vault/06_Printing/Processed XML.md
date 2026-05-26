# Processed XML

## Role
Processed XML import is the print-side ingestion flow that scans workflow output and upserts rows into `processed_print_orders`. It is the main system of record for what the print stack actually queued or processed, including order names, workflow metadata, print file lists, XML source paths, and dedupe keys. In practice, it is the second major identity that the order pipeline must reconcile against Post Purchase intake.

## Connected to
- [[Order Pipeline]]
- [[Print Files]]
- [[Reprint Logic]]
- [[Neon Database]]
- [[Operational Workflow]]
- [[Netlify Functions]]
- [[Data Cleanup]]
