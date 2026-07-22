# CLAUDE.md

Project-specific instructions for working in this repo (`acm2-cc`).

## Memory pruning (spec.md §3.4)

`memory/` holds this repo's prototype memory store. At natural checkpoints —
start of a session, right after loading existing memory files, or before
spawning a subagent that would inherit them — check whether any *active*,
**unpinned** memory entry is actually relevant to the task at hand. Skip
anything with `pinned: true` entirely — pinning is a hard floor (§3.5), not
a factor to weigh; only a human unpins.

If one clearly isn't relevant:

- Propose turning it off with an `Edit` on that file's frontmatter,
  `status: active` → `status: inactive`. Nothing else in the file changes.
- State the reason in the edit (what makes it irrelevant to the current
  task) — this is an `agent-inferred` action per §3.6's attribution
  taxonomy, not a manual one.
- Do this one memory at a time, as an `Edit` tool call. This repo's
  `PreToolUse` hook (`.claude/hooks/pre-memory-write.mjs`) intercepts every
  `Edit`/`Write` under `memory/` and routes it through Claude Code's
  permission dialog, so the proposal always surfaces for a human to approve
  or reject before it lands. Never do this via `scripts/memory-toggle.mjs`
  run through `Bash` — that flips the same field but bypasses the hook
  entirely (the matcher filters by tool name, not by what a `Bash` command
  does internally).

When uncertain whether something's relevant, don't propose turning it off.
An absent memory is far harder to notice than a wrong one — bias toward
leaving it active.
