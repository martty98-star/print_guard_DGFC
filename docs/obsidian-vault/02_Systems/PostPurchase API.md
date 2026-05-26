# PostPurchase API

## Role
This subsystem is the upstream business-order source. Sync jobs and backend helpers ingest Post Purchase payloads into `print_orders_received`, where they become the received-order side of the order pipeline. The browser does not talk to the external API directly; it goes through Netlify Functions and Neon-backed endpoints.

## Connected to
- [[Order Pipeline]]
- [[Neon Database]]
- [[Netlify Functions]]
- [[Admin Auth]]
- [[Operational Workflow]]
- [[PrintGuard Core]]
