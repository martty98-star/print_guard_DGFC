# Submit Tool

## Role
Submit Tool sync reads JobQueue logs from the NAS and writes lifecycle confirmations into `print_lifecycle_events`. It closes the operational gap between an order being received or processed and the point where the workstation workflow actually moved it through production.

## Connected to
- [[Operational Workflow]]
- [[Order Pipeline]]
- [[Neon Database]]
- [[Print Files]]
- [[Netlify Functions]]
