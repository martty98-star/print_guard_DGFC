# Admin Auth

## Role
Admin auth gates destructive or privileged actions through headers and server-side checks such as `requireAdminAccess()` and `requirePostPurchaseAccess()`. It separates operator PIN access for post-purchase workflow screens from full admin access for mutation-heavy maintenance paths.

## Connected to
- [[PrintGuard Core]]
- [[Netlify Functions]]
- [[PostPurchase API]]
- [[Stock System]]
- [[Reprint Logic]]
- [[Operational Workflow]]
