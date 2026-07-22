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

## Agent-shared memory with provenance (spec.md §3.2)

A subagent spawn gets nothing but its `prompt` string — no separate
context channel exists, and it won't reliably go looking in `memory/` on
its own. If a subagent you're spawning needs context from this repo's
memory store, don't let it start cold, and don't assume it'll find the
files itself.

Before spawning:

- Select only the *active* memory entries actually relevant to that
  subagent's specific task — never the whole store.
- Embed them in the prompt under one clearly labeled section, separate
  from the task instructions, e.g.:

  ```
  ## Memory context included for this spawn
  - <entry name>: <why it's relevant to this task>
    <the relevant content/excerpt>
  ```

  That section is the provenance record. A human reviewing the subagent's
  transcript later reads it to see exactly what the subagent was given —
  don't bury it in ordinary prose where it'd blend into the task
  instructions.
- If nothing in `memory/` is relevant, omit the section entirely. Forcing
  one in in when there's nothing to include is noise, not provenance.

This is read-only (§3.2 resolved against write-back): don't ask or expect
a spawned subagent to write to `memory/`. If it reports back something
worth remembering, the main loop writes it — as its own `Edit`/`Write`
call, subject to the same §3.1 approval gate as any other write.
