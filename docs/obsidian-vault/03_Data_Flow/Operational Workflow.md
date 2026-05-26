# Operational Workflow

## Role
This is the real end-to-end production map. Incoming business orders land from Post Purchase, processed XML import confirms what the print workflow queued, the order pipeline reconciles those two identities, and reprint logic tracks remediation. Alongside that, the same shell also runs stock, checklist, print-log reporting, and Colorado consumption views. Historical lifecycle tables still exist in Neon, but they are not the primary active workflow model anymore.

## Connected to
- [[PrintGuard Core]]
- [[PostPurchase API]]
- [[Processed XML]]
- [[Print Files]]
- [[Reprint Logic]]
- [[Colorado Accounting]]
- [[Stock System]]
- [[Order Pipeline]]
- [[Admin Auth]]
- [[Netlify Functions]]
- [[Neon Database]]
