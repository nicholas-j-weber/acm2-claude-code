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

## Companion window read side (spec.md §4.2)

Before treating the content of a `memory/pending/*.md` checkpoint as
settled — e.g. carrying its claims forward into later reasoning — check
whether it's actually been reviewed:

- Check `memory/resolved/<file>` first. If it exists, that's the
  authoritative version (possibly human-edited) — use it, not whatever
  draft content you originally wrote.
- If it's still in `memory/pending/<file>`, don't block on it. Proceed
  with the draft content, but treat it explicitly as unreviewed, and
  schedule a check back with `CronCreate` (`recurring: false`) rather than
  waiting or polling in a loop. Start short — about 2 minutes — since a
  human who's just been handed a checkpoint via the companion window
  often resolves it within moments. If it's still pending when that
  fires, reschedule progressively later (e.g. 2 min → 10 min → 30 min)
  instead of holding one fixed short interval indefinitely.
- Before computing the cron fields, get the actual current time with
  `date` (`Bash`) — never infer it from a checkpoint's file timestamp or
  its `created:` frontmatter (that's UTC, likely a different value than
  local time, and it's the checkpoint's creation time, not now). Guessing
  "now" from nearby file metadata instead of asking for it directly is
  exactly the kind of silent, unverified assumption this whole spec
  exists to avoid.
- These jobs are session-only (per `CronCreate` itself) and disappear if
  the session ends first. That's fine — don't try to work around it. A
  later session just reads `memory/resolved/<file>` directly next time
  that checkpoint's content actually matters.

## Auto mode (spec.md §3.10)

`memory/` writes normally pause for approval (§3.1). If
`.claude/memory-auto-mode` exists, that pause is off: writes land
immediately and get logged to `memory/audit.log` instead.

- The reason stated in an edit (e.g. §3.4's pruning proposals) matters more
  when this is on, not less — with no approval dialog, it's the only
  human-readable trace of *why* a write happened.
- Never toggle it yourself. Don't run `scripts/memory-auto-mode.mjs on` (or
  `off`) via `Bash` on your own initiative, even to reduce prompt friction
  for the user. It changes a safety guarantee the whole write path depends
  on — only a human decides when that trade is worth making.
