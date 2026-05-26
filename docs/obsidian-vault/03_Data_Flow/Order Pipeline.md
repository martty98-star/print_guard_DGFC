# Order Pipeline

## Role
The order pipeline is the main operator-facing reconciliation layer. It combines `print_orders_received`, `processed_print_orders`, and `processed_order_reprint_requests` into `v_print_order_pipeline`, then exposes that through Netlify to the processed-orders UI. This is where operators see whether an order was only received, was processed, is missing detail, or needs reprint handling.

## Connected to
- [[PostPurchase API]]
- [[Processed XML]]
- [[Reprint Logic]]
- [[Print Files]]
- [[Neon Database]]
- [[Netlify Functions]]
- [[Operational Workflow]]
- [[PrintGuard Core]]
- [[Performance Bottlenecks]]
