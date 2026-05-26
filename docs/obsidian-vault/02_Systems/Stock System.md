# Stock System

## Role
The stock system is a separate operational domain inside the same app shell. It manages `pg_items`, `pg_movements`, alerts, exports, and offline-first browser state with sync to Neon. It is not part of the order pipeline, but it shares the same shell, auth gates, reporting utilities, and sync infrastructure.

## Connected to
- [[PrintGuard Core]]
- [[Neon Database]]
- [[Netlify Functions]]
- [[Admin Auth]]
- [[Operational Workflow]]
- [[Performance Bottlenecks]]
