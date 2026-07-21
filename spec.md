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

### 3.2 Agent-shared memory with provenance

Subagents draw from the same store on spawn instead of starting cold. Access
is not "dump the whole store into every prompt" — it's assembled with
**visible provenance**: which specific memory entries were included for this
spawn, so a human auditing a subagent's behavior can see exactly what it was
given, not trust a hand-written summary of it.

*Open question, not yet resolved:* is this read-only (only the main loop
writes, subagents only read), or can subagents write back too? Read-only is
simpler and ships first; write-back raises the concurrent-writer question in
§3.5 immediately.

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

**Open, unresolved design question:** `acm2-browser`'s `Version` model
assumes one head pointer and one writer at a time. Once subagents can write
concurrently (§3.2), that assumption breaks. Two options, not yet decided
between:
  - **Serialize.** A write queue; keep the simple linear-history model.
    Simpler, but a bottleneck if writes get frequent.
  - **Branch.** Real multi-parent history. More powerful, materially bigger
    design lift — this is the harder option and shouldn't be the default
    unless serialization is demonstrated to be a real bottleneck.

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

### 3.8 Live budget visibility

A running sense of how much of the context budget memory/history is
consuming, with a proactive nudge to curate — mirrors the Token Estimator +
compression-recommendation banner in `acm2-browser`. Has no analogue in
Claude Code today; you only notice pressure after compaction already fired.

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
§5.2.

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

## 5. Explicitly open questions

Listed here instead of buried in prose, because they're the two decisions
most likely to change the shape of an implementation if resolved differently
later:

1. **§3.6 — serialize vs. branch** for concurrent subagent writes. No
   evidence yet on whether serialization is actually a bottleneck in
   practice; default to serialize until proven otherwise.
2. **§4.2 — the resolve-polling gap.** Is a `ScheduleWakeup`-driven
   check-back an acceptable amount of asynchrony for a "pending checkpoint,"
   or does the experience need to feel tighter than that? Affects whether
   §4 is worth building as described or needs a different closing mechanism.

## 6. Non-goals (for this draft)

- A general-purpose memory-management UI for casual users who don't want any
  of this friction — everything above should stay opt-in.
- Solving §5.1 up front with a full branching model before serialization is
  shown to be insufficient.
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
| 3.1 | Visible/revertible writes | Not started | Needs its own mechanics check: is there a hook that can intercept a write to the memory directory the way `PreCompact` intercepts compaction (`PreToolUse` matched on `Write`/`Edit`, maybe)? Unverified. | No — verification first |
| 3.3 | On/off without delete | Not started | Nothing blocking — a schema decision (a `status` field, convention for where the toggle lives) | Close — needs scoping, not a decision |
| 3.5 | Pinning as a floor | Not started | Nothing blocking — same shape as 3.3 | Close — needs scoping, not a decision |
| 3.8 | Live budget visibility | Not started | Needs a mechanics check: can Claude Code's current context/token usage actually be queried from a skill/statusline? Unverified. | No — verification first |
| 3.9 | Export/snapshot | Not started | Nothing blocking — could generalize `compaction-archive/`'s approach | Close — needs scoping, not a decision |
| 3.2 | Agent-shared memory w/ provenance | Not started | **§5.1** — read-only vs. write-back changes the design | No |
| 3.4 | Agent-driven relevance pruning | Not started | §3.1 (must route through the visible-proposal mechanism, which doesn't exist yet) | No |
| 3.6 | Chain of accountability | Not started | **§5.1** explicitly (spec text already calls this out) | No |
| 4 | Companion window + bridge | Not started | Not blocked, but this is UI/architecture design work — better suited to conversational design (like §3.7 got) than to loop execution regardless of dependencies | No — wrong kind of work for a loop |

**Reading this table:** the honest next candidates are 3.3, 3.5, or 3.9 —
each needs a short scoping pass (closer to what §3.7 got) but isn't waiting
on you to decide anything. 3.1 and 3.8 need a verification pass before
they're even scoped. Everything touching §5.1 stays parked until that
question is answered.
