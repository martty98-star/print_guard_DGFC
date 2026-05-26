# Stock System

## Role
The stock system manages `pg_items`, `pg_movements`, and related operational UI for inventory state, movements, and low-stock alerting. It is a separate domain from the order pipeline but shares the same application shell, auth model, and Neon-backed sync model.

## Connected to
- [[PrintGuard Core]]
- [[Neon Database]]
- [[Netlify Functions]]
- [[Admin Auth]]
- [[Operational Workflow]]
