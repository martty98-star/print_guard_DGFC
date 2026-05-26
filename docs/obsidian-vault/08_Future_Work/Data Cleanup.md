# Data Cleanup

## Role
Data cleanup is the hygiene layer that keeps the live workflow trustworthy. It covers processed-order dedupe corrections, ignored rows, reprint reconciliation, identity cleanup between business and processed order numbers, and SQL maintenance around views and helper columns. Without it, the pipeline becomes noisy, titles map to the wrong identifiers, and operator decisions stop matching reality.

## Connected to
- [[Neon Database]]
- [[Processed XML]]
- [[Order Pipeline]]
- [[Reprint Logic]]
- [[Performance Bottlenecks]]
- [[Operational Workflow]]
