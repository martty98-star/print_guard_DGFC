# Colorado Accounting

## Role
Colorado accounting is a separate printer-side evidence pipeline. Windows and PowerShell helpers outside the browser parse Colorado export files and store `print_accounting_rows` plus ACL metadata in Neon. The browser reads summarized results for dashboards and reports, but the ingestion path itself is operational infrastructure rather than frontend runtime.

## Connected to
- [[Operational Workflow]]
- [[Neon Database]]
- [[Print Files]]
- [[Performance Bottlenecks]]
- [[Netlify Functions]]
