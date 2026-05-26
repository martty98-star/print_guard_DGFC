# PostPurchase API

## Role
This subsystem ingests incoming business orders from Post Purchase and stores them in `print_orders_received`. It is the upstream source for the order pipeline and one of the two main identities the UI has to reconcile against processed XML records.

## Connected to
- [[Order Pipeline]]
- [[Neon Database]]
- [[Netlify Functions]]
- [[Admin Auth]]
- [[Operational Workflow]]
