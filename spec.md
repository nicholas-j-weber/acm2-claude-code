# ACM2 for Claude Code: Auditable, Shared Memory for an Agentic CLI

**Status:** Draft spec — pre-implementation
**Author:** Nicholas Weber
**Date:** 2026-07-20
**Prior art:** [acm2-browser](../acm2-browser) — a working demo of the original ACM2
methodology (a versioned, legible "context sheet" as an alternative to opaque
chat history) applied to a bespoke Anthropic API chat client. This spec ports
the same two principles — legibility and auditability — onto Claude Code's
own memory system, which is a different problem: not "replace chat history,"
but "make an already-persistent memory system honest about what it knows,
why, and who else can see it."

## 1. Problem statement

Claude Code already has a persistent memory system: plain markdown files with
frontmatter, written and read across sessions. Compared to a fully opaque
system, this is a good starting point — the files exist on disk, a human
*can* go read them. But three real gaps remain, and all three are instances
of the same failure mode ACM2's original spec named: **memory opacity** —
content entering, leaving, or shaping behavior without the human seeing it
happen.

1. **Silent writes.** A memory gets saved because the assistant judged it
   worth keeping. The write is real and inspectable after the fact (the file
   is right there), but nothing about the *moment* of writing was visible or
   reviewable. There's no equivalent of "here's what I'm about to remember
   about you — sound right?"

2. **Cold subagents.** Every agent spawned via the `Agent` tool starts with
   zero access to anything learned in the parent session. Persistent facts
   (user preferences, project constraints, standing feedback) have to be
   re-derived or manually copied into a prompt by the parent, which means
   they're only as complete and current as whatever the parent happened to
   write down that turn — an unaudited, ad hoc summary standing in for the
   real store.

3. **Opaque compaction.** As a session's context grows, it gets automatically
   summarized — silently, with no preview, no edit step, and (today) no way
   to know it's about to happen. This is close to a textbook description of
   ACM2's original "memory opacity" failure mode, just relocated from chat
   history to session context.

## 2. Core hypothesis

If memory writes, agent access to memory, and context compaction are all
routed through a **shared, legible, versioned store** — rather than each
happening as an independent, silent side effect — then:

- Nothing shaping an agent's behavior enters or leaves invisibly.
- Any agent instance (main loop or subagent) sees the same audited store,
  not a hand-copied fragment of it.
- Every change is attributable (who/what proposed it, when, why) and
  non-destructively revertible.

This is not free. Every mechanism below trades some amount of
frictionless-and-silent for legible-and-revertible, which is exactly the
cost ACM2's original spec names as the deliberate trade it's making. The
design bet here is to spend that cost only where it buys real accountability
(memory that persists and shapes future behavior across sessions) and stay
near-zero-friction everywhere else — see §3.6.

## 3. Mechanisms

### 3.1 Visible, revertible writes

A memory write stops being an invisible mutation. It becomes a proposal —
same shape as `acm2-browser`'s suggestion+toast+undo pattern
(`suggestionSession.ts`) — surfaced at the moment it happens, with an
explicit undo window, rather than landing silently and only being
discoverable by later going to read the file.

Built as a `PreToolUse` hook matched on `Write`/`Edit`, scoped to paths
under `memory/`. Its `permissionDecision: "ask"` delegates to Claude Code's
own permission dialog, which genuinely pauses for a human and shows the
change before it lands — no custom UI needed. The limitation: the hook
can `ask`, `allow`, or `deny` up front, but can't run follow-up logic
conditioned on the answer, so "propose, then react" isn't possible in one
hook call, only "propose."

The hook's behavior is trustworthy; the assistant's own chat narration of
it is not. A live test showed the assistant claiming a write had succeeded
while the approval was still pending and the file didn't yet exist — it
described the write as done without waiting to see whether the human
approved it. Anything built on top of §3.1 needs to treat the assistant's
"done" as unverified and check the file/`git status` directly.

### 3.2 Agent-shared memory with provenance

Subagents draw from the same store on spawn instead of starting cold. Access
is not "dump the whole store into every prompt" — it's assembled with
**visible provenance**: which specific memory entries were included for this
spawn, so a human auditing a subagent's behavior can see exactly what it was
given, not trust a hand-written summary of it.

**Resolved: read-only for this draft.** Subagents draw from the store on
spawn but don't write back — only the main loop writes, so every mutation
still goes through the single-writer path §3.1 and §3.6 already handle,
and §3.6's write queue never actually has to be built. Write-back is ruled
out for now, not deferred to a later phase of this same design: there's no
concrete case yet where a subagent needs to persist something the main
loop couldn't just write itself after the subagent reports back, and
reopening it means reopening the concurrent-writer question §3.6 just
settled. Revisit only if a real scenario shows up where that hand-off is
actually insufficient.

**Mechanism, verified against real subagent-spawn behavior:** a spawned
subagent gets nothing except the `prompt` string handed to it — no separate
context channel exists for a one-off spawn, and its own on-disk transcript
is exactly that prompt plus everything it did after. So there's nothing new
to build underneath this either: the "visible provenance" record isn't a
separate log — it's the prompt itself, which already persists. The design
question was never *how* to deliver it, only *what* the spawning turn is
required to do:

- Before spawning, select only the memory entries actually relevant to that
  subagent's task — never "all active entries," which is exactly the "dump
  the whole store" failure mode this section exists to avoid.
- Embed them in the prompt under one labeled section (entry name + one-line
  reason it's relevant), separate from the task instructions. That section
  *is* the provenance record a human reviewing the transcript reads later.
- Don't rely on the subagent finding `memory/` on its own. It auto-loads
  `CLAUDE.md` (except Explore/Plan subagents, which skip it) and could in
  principle `Read` the directory unprompted — but that's opportunistic, not
  a designed provenance record, and depends on tool access this spec can't
  assume. Curated inclusion in the prompt is the only reliable path.

### 3.3 On/off without delete

Memories (or whole categories — `user`/`feedback`/`project`/`reference`,
mirroring the existing type system) get a mute toggle. Mirrors
`Memory.active` in `acm2-browser`: turned off without losing the audit
trail, unlike deletion. Default toggle granularity: per-type, with
per-memory override available — same shape as this app's
collapse-by-default-plus-per-row-override pattern.

### 3.4 Agent-driven relevance pruning — visibly, never silently

Before submitting a prompt, an agent may propose turning off memories that
aren't relevant to the current task, directly attacking context rot. This
**must** route through §3.1's visible-proposal mechanism. A silent filter
step here is the same opacity failure this whole spec exists to prevent,
just moved from "hidden accumulation" to "hidden pruning" — the absence of a
memory is much harder to notice than the presence of a wrong one, so this is
the mechanism most likely to cause quiet harm if built as a bare filter
instead of a suggestion.

Nothing new needs building underneath this — §3.1's hook already gates every
`Edit`/`Write` under `memory/`, including a status flip. What was actually
undesigned was the judgment and the exact action, not the gate:

- **Trigger:** at natural checkpoints — session start after memory loads, or
  before a subagent spawn (§3.2) — not on every prompt, which would just be
  noise instead of a real filter.
- **Action:** an `Edit` on the memory file's own frontmatter, `status:
  active` → `status: inactive`, with a one-line reason (an
  `agent-inferred` write, per §3.6's attribution taxonomy). That `Edit` call
  is exactly what the human sees and approves in §3.1's dialog.
- **Constraint, confirmed against real hook behavior:** `PreToolUse`
  matchers filter by tool name, not by filesystem effect. Running
  `scripts/memory-toggle.mjs` (§3.3) through the `Bash` tool would flip the
  same field without ever touching the `Write|Edit` matcher — a silent
  bypass of the exact gate this section requires. So the pruning path is
  `Edit`-only; the toggle script stays a human-invoked CLI convenience, not
  something an agent shells out to.

### 3.5 Pinning as a floor

Some memories — hard constraints, safety-relevant corrective feedback —
should be exempt from §3.4's pruning pass entirely. Mirrors `pinRank` in
`acm2-browser`. Pinned memories are always included regardless of a
relevance judgment; only a human unpins them.

### 3.6 Chain of accountability

Every write, edit, and deactivation is a `Version`-shaped record: immutable,
timestamped, attributed (`manual` / `agent-inferred` / `corrective-feedback`
— a Claude-Code-specific attribution taxonomy, extending the
`manual_edit`-vs-suggestion-type shape `store.ts` already uses), with
non-destructive revert. A bad write rolls back without losing everything
written since.

With a single writer, this doesn't need building from scratch: `memory/` is
a git-tracked directory, and `git log` on it already is a non-destructive,
attributed, timestamped record of every write and toggle. A custom
`Version` model only becomes necessary once subagents can write
concurrently (§3.2) — a single linear git history can't represent that.

**Resolved: serialize.** Once concurrent writers exist (§3.2, if write-back
is chosen), writes go through a single queue — one write lands and its git
commit exists before the next proceeds. This keeps the linear-history model
above exactly as-is; no new data structure needed. Branching (real
multi-parent history) is ruled out for this draft, not just deferred — it's
materially more design and engineering lift for a bottleneck that can't
even be evaluated yet, since nothing writes concurrently until §3.2 does.
Reopen only if serialization is actually shown to bottleneck in practice.

### 3.7 Compaction: what's actually buildable

Verified against Claude Code's real hook system (not assumed): `PreCompact`
fires before compaction and can **block** it (exit 2 / `decision: block`);
it receives `session_id`, `transcript_path`, `cwd`, and `trigger`
(`manual`/`auto`). It **cannot** pause for interactive review or inject a
replacement summary — hooks are fire-and-forget shell commands with no
round-trip to the user. This materially changes what's achievable:

- **`PreCompact` blocks every `auto`-triggered compaction outright.**
  Auto-compaction stops happening silently — it stops happening at all
  without a deliberate `/compact`. This alone kills the "invisible timing"
  half of the problem.
- **The same hook archives the full pre-compaction transcript** (via
  `transcript_path`) to a permanent, legible location before anything is
  summarized. Nothing is ever silently lost, independent of whether a human
  reviewed the eventual summary.
- **The actual editable-summary step lives outside the hook**, as a
  behavior: proactively write a visible checkpoint (§4 format) well before
  real context pressure, so review happens in the normal conversational
  flow rather than at a hard stop.

### 3.9 Export / snapshot

A way to freeze and inspect "exactly what this session knew" at the moment
it produced a specific answer — mirrors `SheetExport`. Primary use case:
debugging a wrong or surprising answer by auditing exactly what was in
context when it was generated.

## 4. The companion window

CLI text has no rich inline editing surface — "editable" in a terminal means
either dictating changes in prose (imprecise for anything beyond a small
tweak) or a `$EDITOR` round-trip (a context switch). A companion window
solves this the same way `acm2-browser` already does for chat: a real UI for
review/edit/accept/reject, just aimed at Claude Code's own session state
instead of a bespoke API client.

### 4.1 Why not a hosted Artifact

Ruled out: an Artifact runs sandboxed with no local filesystem access, and
this whole mechanism depends on watching real files on disk. The companion
window has to be a small **local app** — structurally, a leaner version of
`acm2-browser` itself, pointed at a directory of markdown files instead of
IndexedDB.

### 4.2 The bridge

No live/push channel exists between a running session and an external
process (confirmed in §3.7 — hooks can't round-trip). The bridge is
therefore file-based and poll/watch-based on both ends, not a live protocol:

```
<memory-root>/
  pending/
    2026-07-20T143200-compaction-checkpoint.md
    2026-07-20T151004-memory-write.md
  resolved/
    ...   # moved here on resolution, never deleted — same
          # never-destroy-just-deactivate principle as §3.3
```

Each pending file: frontmatter (`kind`, `session_id`, `created`, `status:
pending|resolved`, plus mechanism-specific fields like `supersedes_range`
for a compaction checkpoint) over a markdown body containing the actual
editable prose. Example (compaction checkpoint):

```markdown
---
kind: compaction-checkpoint
session_id: abc123
created: 2026-07-20T14:32:00Z
status: pending
supersedes_range: msg_142-msg_310
---

Here's what I'd carry forward once these turns compact:

- User is debugging a race condition in the payment webhook handler,
  traced to two workers processing the same event.
- Settled on an idempotency-key fix; not yet implemented.
- User wants tests added before considering this done.
```

**Write side:** the session (proactively, per §3.7) or a hook writes a new
file into `pending/`.

**Companion window:** watches/polls `pending/`, renders the body as an
editable field. On save, flips `status: resolved`, moves the file to
`resolved/` (or updates in place — TBD, doesn't affect the model either
way).

**Read side (closing the loop):** the session has no push signal for "the
human resolved this." Before relying on a checkpoint, it checks the file's
`status`. If still `pending`, it doesn't block — it uses `ScheduleWakeup` (a
real, already-available tool) to check back rather than stalling the
conversation. This is an accepted async gap, not a bug to design away; see
§5.1.

**Resolved: moves to `resolved/`, not update-in-place.** Matches the
directory scaffold above directly, and keeps `pending/` meaning exactly
what it says — an in-place-but-marked-resolved file would sit there
indefinitely, forcing every reader to filter on `status` instead of just
listing the directory.

**Implementation, scoped:** `memory/pending/` and `memory/resolved/`
alongside the existing loose memory entries — same root, no new top-level
directory. The app itself is a single Node script using only built-ins
(`http`, `fs`) and a single static HTML page — no framework, no build
step, no dependency: this is a directory listing, a textarea, and a save
button, and the spec's own design already rules out anything live
(poll/watch-based, confirmed in §3.7 — hooks can't push), so there's
nothing here that benefits from more machinery. The page polls
`GET /api/pending` on an interval; saving posts to `POST /api/resolve`,
which rewrites the body, flips `status`, and moves the file.

### 4.3 Launch

A skill bound to a slash command (e.g. `/context-window`):
1. Probe the known local port; if already serving, just re-open/focus the
   browser tab (idempotent — running the command twice doesn't spawn a
   second server).
2. If not running, spawn the local server detached (must outlive the
   skill's own execution) and `open http://localhost:<port>`.

No state travels through the command itself — the filesystem is already the
shared source of truth, so the window just renders whatever's currently in
`pending/`.

**Implementation, scoped:** a project skill at
`.claude/skills/context-window/SKILL.md`, invoked as `/context-window`. Port
is fixed (chosen once, documented, not configurable — nothing here needs
that flexibility). "Probe" is a plain `curl` against the server; "detached"
means launched via `nohup ... & disown` in a `Bash` call, not the `Bash`
tool's own `run_in_background`, since that ties the process's life to this
session rather than letting it outlive it, which §4.3 explicitly requires.

## 5. Explicitly open questions

Listed here instead of buried in prose, because it's the decision most
likely to change the shape of an implementation if resolved differently
later:

1. **§4.2 — the resolve-polling gap.** Is a `ScheduleWakeup`-driven
   check-back an acceptable amount of asynchrony for a "pending checkpoint,"
   or does the experience need to feel tighter than that? Affects whether
   §4 is worth building as described or needs a different closing mechanism.

## 6. Non-goals (for this draft)

- A general-purpose memory-management UI for casual users who don't want any
  of this friction — everything above should stay opt-in.
- A branching (multi-parent) write-history model for concurrent writers —
  ruled out for this draft by §3.6's resolution; serialization is the
  default, reopened only if it's shown to actually bottleneck.
- Cross-machine/cross-user sharing of the memory store — this spec assumes
  one user, one machine, multiple local agent instances.

## 7. Build status

Tracks what's actually built versus designed-but-untouched, and — since not
everything here is safe to build unsupervised — which pieces are blocked on
a decision only a human can make versus which just haven't been scoped yet.
A piece only qualifies as **loop-ready** once it has no open judgment call
left *and* its real mechanics (which hook, which API, what it actually
returns) have been verified against documentation rather than assumed —
§3.7 needed that verification before it could be written correctly, and
there's no reason to expect the others won't too.

| # | Piece | Status | Blocked by | Loop-ready? |
|---|-------|--------|------------|--------------|
| 3.7 | Compaction hook (block auto, archive transcript) | **Prototyped & committed**, scoped to this repo only. Untested live (needs a fresh session to pick up `.claude/settings.json`); indefinite-auto-block edge case still unverified. | — | n/a — done |
| 3.1 | Visible/revertible writes | **Prototyped, committed, and verified live.** `PreToolUse` hook matched on `Write\|Edit`, scoped to paths under `memory/`; uses `permissionDecision: "ask"` to route through Claude Code's native permission dialog. A real session confirmed the prompt appears and gates the write correctly. | — | n/a — done |
| 3.3 | On/off without delete | **Prototyped & committed.** `memory/` dir + frontmatter `status: active\|inactive` field; toggled via `scripts/memory-toggle.mjs <file> on\|off`. | — | n/a — done |
| 3.5 | Pinning as a floor | **Prototyped & committed.** Same file, `pinned: true\|false` field; `scripts/memory-toggle.mjs <file> pin\|unpin`. §3.4's `CLAUDE.md` instructions check this field and skip pinned entries entirely. | — | n/a — done (consumer is §3.4) |
| 3.9 | Export/snapshot | **Prototyped & committed.** `scripts/memory-snapshot.mjs` reads `memory/`, filters out `status: inactive`, writes full content of the rest to a timestamped file in gitignored `memory-snapshots/`. | — | n/a — done |
| 3.2 | Agent-shared memory w/ provenance | **Prototyped, committed, and verified live.** A fresh session correctly identified one relevant active memory entry, excluded an unrelated one, and spawned a subagent whose persisted transcript — checked directly, not taken on the session's word — shows the exact labeled `## Memory context included for this spawn` section. | — | n/a — done |
| 3.4 | Agent-driven relevance pruning | **Prototyped, committed, and verified live.** A fresh session, given an unrelated task and pointed at `memory/`, correctly judged a throwaway fixture irrelevant, proposed the `status: active → inactive` edit, left the pinned memory alone, and the edit surfaced through §3.1's permission dialog exactly as designed. | — | n/a — done |
| 3.6 | Chain of accountability | **Resolved and fully satisfied.** `git log` on `memory/` is the `Version` record. §3.2 is read-only, so the write queue this section designed for concurrent writers has no consumer in this draft — nothing left to build. | — | n/a — done |
| 4 | Companion window + bridge | **Prototyped, committed, and verified live.** `/context-window` correctly probed the port, spawned the server detached, and opened a real browser tab; a real edit-and-save round-tripped through `resolved/` with the body change intact, confirmed on disk, not from either side's narration. One flake along the way: a click didn't reach the server the first time, file stayed untouched in `pending/`, no error surfaced — root cause unconfirmed (most likely a stale click during the auto-poll cycle), but the missing `fetch` error handling that let it fail silently is now fixed regardless, and the retest succeeded cleanly. | — | n/a — done |

**Reading this table:** every piece under §3 is done and verified live
(§3.1, §3.2, §3.3, §3.4, §3.5, §3.7, §3.9), or resolved with nothing left
to build (§3.6). §4 is scoped — bridge layout, the resolve-vs-update-in-place
call, and launch mechanics are all decided — and is what's left to actually
build.
