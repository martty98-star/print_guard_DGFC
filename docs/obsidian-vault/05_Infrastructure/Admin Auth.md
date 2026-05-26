# Admin Auth

## Role
Admin auth is the gatekeeper for privileged mutations. The browser uses role state, admin PINs, and Post Purchase PINs for UI access, while the backend enforces headers through helpers such as `requireAdminAccess()` and `requirePostPurchaseAccess()`. It separates ordinary operator visibility from destructive maintenance paths, reprint actions, and admin-only stock or checklist operations.

## Connected to
- [[PrintGuard Core]]
- [[Netlify Functions]]
- [[PostPurchase API]]
- [[Stock System]]
- [[Reprint Logic]]
- [[Operational Workflow]]
- [[Order Pipeline]]
