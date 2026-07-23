# ACM2 for Claude Code: SDK Rebuild

**Status:** Draft — for collaboration, not yet built
**Relationship to `spec.md`:** `spec.md` documents what's actually built and
verified live today (a set of hooks + a companion window layered onto the
interactive Claude Code CLI). This document proposes replacing the CLI as
the driver with a custom program against the Claude Agent SDK. Nothing here
is built yet; `spec.md` stays accurate to the current state until/unless
this supersedes it.

## 1. Why

The interactive CLI has its own built-in auto-memory system — a directory
under `~/.claude/projects/<project>/memory/`, entirely separate from this
repo's `memory/`, governed by none of `spec.md`'s mechanisms. It's real, not
hypothetical: this exact project has one, and it's live for the whole
duration of any CLI session. It happened to be empty when checked, but nothing
stops it from writing something about this project through a channel no hook,
no approval dialog, and no companion window in `spec.md` ever sees. That's
the precise "memory opacity" failure `spec.md` §1 was written to kill, now
showing up in the tool being used to prototype the fix.

Two more reasons pull in the same direction:

- `spec.md` was drafted collaboratively with Claude across the whole prototype
  so far — useful, but not guaranteed to match user intent as it keeps
  evolving. A driving program under direct control is easier to keep honest
  to that intent than a spec text an agent keeps re-interpreting each session.
- It reopens the stateless-per-submission model raised earlier (mirrors
  acm2-browser's `serializer.ts`: reconstruct full context explicitly on
  each call) — not achievable inside the interactive CLI (no hook or
  mechanism can intercept per-turn context assembly there), but achievable
  here, with tradeoffs (§3).

## 2. What's verified about the Agent SDK

Checked against real SDK docs, not assumed — same discipline `spec.md` used
throughout (its `PreToolUse`/`CronCreate` corrections both came from skipping
this step once and catching it live).

1. **Permission callback exists.** `canUseTool` runs in the driving program's
   own process and can `allow`/`deny`/`ask`/`defer` any tool call before it
   executes. This is a real interception point, not a CLI-only concept.
2. **Hooks still fire in SDK mode.** `PreToolUse`, `PreCompact`, `Stop`, and
   the rest of Claude Code's hook lifecycle run for SDK-driven sessions too,
   via the same `settings.json` filesystem hooks or programmatic callbacks
   passed to `query()`. This means `.claude/hooks/pre-memory-write.mjs` and
   `.claude/hooks/pre-compact.mjs` are candidates to carry over largely
   as-is (§4) — this is not a from-scratch rebuild of everything.
3. **Auto-memory is on by default in SDK mode too — and can be disabled.**
   `autoMemoryEnabled: false` (or `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1`) turns
   it off. This directly resolves §1's actual concern: the blackbox store
   doesn't have to be tolerated, it can be switched off entirely once we're
   not going through the interactive CLI's default settings.
4. **`CLAUDE.md` auto-loads by default** (`settingSources` includes
   `"project"`), same as the CLI. No behavior change needed there.
5. **Compaction is still automatic and not opt-out.** The driving program
   doesn't get to skip it, only hook `PreCompact` the same way `spec.md`
   §3.7 already does. No architecture change needed here either.
6. **True stateless-per-submission is a session-management choice, not a
   free property of the SDK.** Context persists across `query()` calls
   *within* a session by default. Getting acm2-browser-style
   reconstruct-everything-explicitly behavior means deliberately not
   resuming a session between submissions — starting fresh each time and
   re-supplying whatever context the memory store says is relevant. This is
   a real design decision, not a default (§3).

## 3. Resolved design decisions

- **Session boundary: fresh session per submission, no resume.** A
  submission is one `query()` call — the full task/turn including whatever
  tool calls it takes until the agent stops. The next submission starts a
  new session rather than resuming; whatever context matters gets
  reconstructed explicitly from the memory store each time. This is the
  real stateless-per-submission property §1/§2.6 were after — chosen over a
  longer-lived resumed session specifically because a resumed session
  quietly reintroduces the "context accumulates and nobody fully knows
  what's in it" problem this whole rebuild exists to kill.
- **Write gating: `canUseTool`, not the `PreToolUse` hook + marker file.**
  In-process, so it can hold auto-mode state directly instead of a
  filesystem marker (`.claude/memory-auto-mode` was only ever a workaround
  for the hook running as a separate process with no shared state — that
  workaround's reason for existing goes away here). `pre-memory-write.mjs`
  and `pre-compact.mjs` stay as-is for the CLI prototype on `main`; the
  rebuild reimplements the write-gating logic as a `canUseTool` callback,
  not a shelled-out hook script.
- **Default posture: auto + audit, not ask-by-default.** Gating every write
  behind a dialog trains click-through-without-reading, which is a weaker
  guarantee than an audit trail someone can actually inspect. Writes and
  agent-driven pin/status toggles proceed by default and land in the audit
  log; the companion window surfaces that log prominently (not a file you
  have to go find) so "auditable" stays true in practice, not just in
  theory. Full `ask`-and-block mode stays available, opt-in, for anyone who
  wants to micromanage what lands in context — same shape as today's
  `§3.10` auto-mode toggle, just with the default flipped.
- **Companion window: primary interface, but low-friction by design.** It's
  where chat, memory review, and (when opted into) approvals all live —
  not a mandatory checkpoint most users interact with, since most people
  will run in auto mode and only open it when they actually want to look.
- **Subagent memory access: read, plus narrow write (pin/status toggle
  only) — not full write-back.** Extends `spec.md` §3.3/§3.5's existing
  toggle shape (frontmatter-only, via `setField` — `status` and `pinned`,
  never body content or new entries) to subagents, instead of the
  main-loop-only toggle it is today. Creating or editing memory content
  stays main-loop-only, same as `spec.md` §3.2's original resolution — this
  isn't full concurrent-writer support, just a wider set of hands allowed
  to flip an existing switch. One known gap, deliberately not designed
  around yet: two agents flipping the same file's status at the same
  instant can race (last write wins, the other flip silently drops). Narrow
  and low-stakes enough to defer — reopen only if it's shown to actually
  happen, same "reopen only if shown to bottleneck" spirit `spec.md` §3.6
  used for its own concurrency question.

## 4. What carries over vs. what's new

**Carries over largely as-is** (already built, self-tested, verified live
against real Claude Code behavior in `spec.md`):
- `scripts/frontmatter.mjs` — the flat frontmatter read/write helpers,
  independent of which harness is driving.
- The `memory/` frontmatter model itself (`status`, `pinned`, `summarizes`)
  and the pending/resolved bridge in `companion/`.
- `.claude/hooks/pre-compact.mjs` — compaction is still automatic and
  `PreCompact` still fires in SDK mode (§2.5); no reason to reimplement it.

**Superseded by §3's decisions, stays on `main` for the CLI prototype only:**
- `.claude/hooks/pre-memory-write.mjs` and `.claude/memory-auto-mode` — the
  marker-file toggle was a workaround for the hook's separate-process
  statelessness. The rebuild's `canUseTool` callback replaces both with
  in-process state, so neither ports over.
- `scripts/memory-toggle.mjs`/`scripts/memory-auto-mode.mjs` as *CLI*
  convenience scripts — the underlying `setField` operations they wrap
  still matter (agents now call them directly for pin/status toggles, §3),
  just not as human-invoked scripts in the rebuilt flow.

**New, and the actual scope of this rebuild:**
- The driving program itself — owns the `query()` loop, fresh-session-per-
  submission boundaries, and the `canUseTool` callback (auto-by-default,
  with opt-in `ask` mode).
- Explicit `autoMemoryEnabled: false` — one line, but the concrete fix for
  §1's motivating concern.
- The companion window's expansion into the primary interface: chat surface
  plus the audit-log view plus (opt-in) the pending-approval panel.
- Reconstructing whatever context a submission needs from the memory store,
  fresh, each call.

## 5. Next steps

1. Resolve the open questions in §3 together.
2. Push this repo to GitHub (reverses the "local only" constraint this
   prototype has held until now — deliberate, per explicit instruction).
3. Do the rebuild on a new branch, `spec.md`/current hooks left intact on
   `main` until the rebuild is verified live to at least the same bar.
