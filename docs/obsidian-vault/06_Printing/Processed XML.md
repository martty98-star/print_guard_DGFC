# Processed XML

## Role
Processed XML import is the pipeline that reads RIP or workflow output and upserts rows into `processed_print_orders`. It is the system of record for what the print stack actually queued or processed, including print file lists, workflow names, source XML metadata, and order dedupe keys.

## Connected to
- [[Order Pipeline]]
- [[Print Files]]
- [[Reprint Logic]]
- [[Neon Database]]
- [[Operational Workflow]]
- [[Data Cleanup]]
