# Neon Database

## Role
Neon is the canonical persistence layer for the whole product. It stores order intake in `print_orders_received`, processed XML in `processed_print_orders`, reprint requests, stock data, checklist data, print accounting data, print-log data, subscriptions, and the SQL views that unify those domains for UI and reporting. If the browser, Netlify layer, or local sync scripts disagree, Neon is the shared truth they are converging on.

## Connected to
- [[Order Pipeline]]
- [[PostPurchase API]]
- [[Processed XML]]
- [[Print Files]]
- [[Reprint Logic]]
- [[Colorado Accounting]]
- [[Stock System]]
- [[Netlify Functions]]
- [[Data Cleanup]]
- [[Performance Bottlenecks]]
