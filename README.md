# acm2-cc

A Claude Code plugin that makes the CLI's memory system auditable: every
write is a visible proposal (not a silent mutation), subagents get
provenance-tracked context instead of starting cold, and compaction can't
happen without warning. In beta.

## What it actually does

- **Visible, revertible memory writes.** Any `Write`/`Edit` under `memory/`
  is intercepted by a hook and routed through Claude Code's own permission
  dialog, so a memory write is something you approve, not something that
  just lands.
- **No silent compaction.** Auto-triggered compaction is blocked outright;
  the full pre-compaction transcript is archived first either way, so
  nothing is ever lost even if you never review it.
- **Subagents get labeled context, not a cold start.** Before spawning a
  subagent, relevant memory entries are selected and embedded in its prompt
  under an explicit `## Memory context included for this spawn` section —
  so you can see exactly what it was given, not guess.
- **On/off and pinning without deletion.** Memories can be deactivated
  (`status: inactive`) or pinned against pruning, without ever being
  destroyed — the audit trail is just `git log` on `memory/`.
- **A companion window** — a local, no-dependency web UI (`companion/`) for
  reviewing pending checkpoints and editing/pinning/deleting/compressing
  memory entries by hand, dark by default since it's a companion to a
  terminal app.
- **Auto mode**, opt-in, for when the per-write approval dialog becomes
  pure friction: writes land immediately and get logged to
  `memory/audit.log` instead.

Native Claude Code auto-memory (the built-in cross-session memory system)
is disabled via `autoMemoryEnabled: false` in `.claude/settings.json` — this
plugin's own governed `memory/` store replaces it, rather than running
alongside it ungoverned.

## Quickstart

1. Copy these into your project:
   - `.claude/hooks/` (the write-approval and compaction hooks)
   - `.claude/settings.json` (wires the hooks up, disables native
     auto-memory)
   - `.claude/skills/context-window/` (the `/context-window` launcher)
   - `scripts/` (toggle/snapshot/history CLI helpers)
   - `companion/` (the local review UI)
   - `CLAUDE.md` (instructs the agent how to use all of the above)
2. Your project needs to be a git repo — the audit trail is `git log` over
   `memory/`, not a custom data structure.
3. Start a session as normal. The first memory write will trigger the
   approval dialog described above.
4. Run `/context-window` to open the companion window
   (`http://localhost:4317`) for reviewing pending checkpoints or managing
   memory entries by hand.

## CLI helpers (`scripts/`)

- `memory-toggle.mjs <file> on|off|pin|unpin` — flip a memory's active/pinned
  state by hand.
- `memory-auto-mode.mjs on|off|status` — toggle auto mode (§ above). Only a
  human should run this — the agent is instructed not to.
- `memory-snapshot.mjs` — freeze every active memory entry's full content to
  a timestamped file, for debugging what a session actually knew.
- `memory-history.mjs [file]` — `git log -p` over `memory/` (or one file),
  without having to remember the flags.

## Status

Experimental, early beta. Every mechanism above has been exercised in a real
running session and confirmed on disk rather than taken on faith — but only
within this repo's own test loop. It hasn't yet been used to actually build
a project. Expect rough edges once it meets a real workflow.
