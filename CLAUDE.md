\# Project

This is an offline-first PWA for print/inventory/reporting workflows.



\# Stack

\- Vanilla JavaScript

\- HTML/CSS

\- IndexedDB for local persistence

\- Netlify Functions for backend endpoints

\- Keep changes compatible with current runtime unless explicitly asked to refactor



\# Working rules

\- Prefer minimal diffs over broad rewrites

\- Do not rename files or move architecture unless explicitly requested

\- Preserve current behavior unless the task explicitly changes behavior

\- When fixing a bug, explain root cause briefly, then patch only affected areas

\- For UI work, keep layout stable and mobile-safe

\- For exports, do not break existing CSV/XLS/PDF flows

\- Before introducing new dependencies, ask whether a dependency is acceptable

\- Prefer copy-paste ready code



\# Output rules

\- Be concise

\- Show exact files changed

\- For bigger tasks, propose a short plan first



\# Compact instructions

When using compact, preserve:

\- current task goal

\- files changed

\- important constraints

\- unresolved bugs

Ignore:

\- long explanations

\- repeated logs

\- abandoned ideas

