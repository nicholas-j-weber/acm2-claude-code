---
description: Open the acm2-cc companion window (spec.md §4) — a local UI for reviewing/editing pending checkpoints and memory proposals.
allowed-tools: Bash(curl *) Bash(nohup *) Bash(open *)
disable-model-invocation: true
---

Launch the companion window. No state travels through this command — the
filesystem (`memory/pending/`) is already the shared source of truth, so the
window just renders whatever's there.

1. Probe the port: `curl -s -o /dev/null -w "%{http_code}" http://localhost:4317/`.
   If it responds, the server is already running — skip to step 3.
2. If not running, start it detached so it outlives this command:
   `cd "${CLAUDE_PROJECT_DIR}" && nohup node companion/server.mjs > /tmp/acm2-cc-companion.log 2>&1 & disown`.
   Give it a second to bind the port before continuing.
3. Open the browser tab: `open http://localhost:4317`. Re-running this
   command when the server's already up should just re-open/focus the tab,
   not spawn a second server.
