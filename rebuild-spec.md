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

## 3. Open design questions — for collaboration, not yet decided

- **Session boundary policy.** One `query()` call per submission with no
  resume (true statelessness, closest to the original motivation) vs. a
  longer-lived session with periodic resets (cheaper, more like today's
  CLI session, weaker on the "nothing carries over silently" property).
  This is the central tradeoff of the whole rebuild and should be settled
  before anything else here.
- **`canUseTool` vs. the existing `PreToolUse` hook — pick one, not both.**
  Both can gate a memory write; running both would just be two approval
  paths for the same event. `canUseTool` runs in-process (no shell-out, can
  hold richer state like the auto-mode marker directly instead of checking a
  file); the hook is what's already built and verified live. Leaning
  `canUseTool` for the rebuild specifically because in-process state removes
  the marker-file toggle's whole reason for existing — worth discussing.
- **What "a submission" actually is.** A single user message? A full
  task/turn including all tool calls until the agent stops? This determines
  what "stateless per submission" even means operationally and needs to be
  pinned down before session-boundary policy (above) can be decided.
- **Companion window's role.** Currently a side-channel for reviewing
  pending checkpoints and editing memory entries (`spec.md` §4). If the
  driving program owns the loop, does the companion window become the
  primary interface (replacing whatever chat UI exists), or stay a
  secondary review surface alongside a separate driving-program UI?
- **Where does the "propose, don't just write" pattern from `spec.md` §3.1
  live now?** The interactive CLI's native permission dialog was the whole
  reason that mechanism didn't need a custom UI. Without the CLI, either
  `canUseTool` needs a real UI surface (the companion window, presumably)
  or the driving program needs its own.

## 4. What carries over vs. what's new

**Carries over largely as-is** (already built, self-tested, verified live
against real Claude Code behavior in `spec.md`):
- `.claude/hooks/pre-memory-write.mjs`, `.claude/hooks/pre-compact.mjs` —
  hooks still fire in SDK mode (§2.2).
- `scripts/frontmatter.mjs`, `scripts/memory-toggle.mjs`,
  `scripts/memory-auto-mode.mjs` — pure file operations, independent of
  which harness is driving.
- The `memory/` frontmatter model itself (`status`, `pinned`, `summarizes`)
  and the pending/resolved bridge in `companion/`.

**New, and the actual scope of this rebuild:**
- The driving program itself — owns the `query()` loop, session boundaries,
  and whatever `canUseTool`/hook wiring is chosen (§3).
- Explicit `autoMemoryEnabled: false` — one line, but the concrete fix for
  §1's motivating concern.
- Whatever the session-boundary decision (§3) requires for reconstructing
  context per submission.

## 5. Next steps

1. Resolve the open questions in §3 together.
2. Push this repo to GitHub (reverses the "local only" constraint this
   prototype has held until now — deliberate, per explicit instruction).
3. Do the rebuild on a new branch, `spec.md`/current hooks left intact on
   `main` until the rebuild is verified live to at least the same bar.
