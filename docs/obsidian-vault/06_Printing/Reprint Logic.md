# Reprint Logic

## Role
Reprint logic sits on top of the pipeline and tracks recovery work. It combines reprint-like evidence from processed XML with explicit operator-created requests in `processed_order_reprint_requests`, then feeds status back into the order pipeline UI. This is the layer that turns duplicate print attempts and manual interventions into an understandable operational state.

## Connected to
- [[Order Pipeline]]
- [[Processed XML]]
- [[Print Files]]
- [[Admin Auth]]
- [[Neon Database]]
- [[Netlify Functions]]
- [[Data Cleanup]]
