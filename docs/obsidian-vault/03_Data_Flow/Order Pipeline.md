# Order Pipeline

## Role
The order pipeline is the normalized operational view that joins incoming business orders with processed print records and reprint state. In the database it is represented by `v_print_order_pipeline`, and in the UI it is the main place where operators understand whether an order was only received, fully processed, or needs reprint attention.

## Connected to
- [[PostPurchase API]]
- [[Processed XML]]
- [[Reprint Logic]]
- [[Print Files]]
- [[Neon Database]]
- [[Netlify Functions]]
- [[Operational Workflow]]
- [[Performance Bottlenecks]]
