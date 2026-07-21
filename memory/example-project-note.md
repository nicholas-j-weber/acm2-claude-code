---
name: acm2-cc-scope
description: acm2-cc prototypes stay scoped to this repo, not installed globally.
metadata:
  type: project
status: active
pinned: true
---

The hooks and scripts built while prototyping spec.md stay local to this
repo's own `.claude/settings.json` and `memory/` directory — none of it is
installed into the user's global Claude Code config.

**Why:** user explicitly said "Scope it to acm2-cc first"; nothing here
should affect other projects until asked.

**How to apply:** any new mechanism added while building out the spec stays
local to this repo unless the user says to go global.
