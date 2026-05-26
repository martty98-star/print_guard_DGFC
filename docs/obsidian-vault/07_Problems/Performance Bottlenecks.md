# Performance Bottlenecks

## Role
The main bottlenecks are concentrated around the large order pipeline view, repeated full-state browser refreshes, broad scans over processed XML or reporting data, and remaining orchestration pressure in `app.js`. The biggest levers are SQL/index hygiene, reducing expensive cross-domain joins, and continuing to decompose browser runtime boundaries so fewer screens reload more state than they need.

## Connected to
- [[PrintGuard Core]]
- [[Order Pipeline]]
- [[Neon Database]]
- [[Netlify Functions]]
- [[Stock System]]
- [[Data Cleanup]]
- [[Operational Workflow]]
