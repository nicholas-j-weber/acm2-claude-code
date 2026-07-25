#!/usr/bin/env node
// PreCompact hook — spec.md §3.7.
//
// Archives the pre-compaction transcript unconditionally (nothing should
// ever be silently lost), then blocks only auto-triggered compaction.
// Manual /compact is already a deliberate, visible user action, so it's
// left alone. Hooks can't pause for interactive review (verified against
// real Claude Code docs before writing this — see spec.md §3.7), so this
// is the honest version of "make compaction visible": stop it from
// happening silently, not show a preview. The preview/edit step is a
// separate, unbuilt piece (the proactive-checkpoint behavior, §3.7).

import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ARCHIVE_DIR = join(process.cwd(), "compaction-archive");

export function decide(payload) {
  if (payload.trigger === "auto") {
    return {
      decision: "block",
      reason:
        "ACM2 prototype: auto-compaction blocked so it can't happen silently. Run /compact yourself when ready — the pre-compaction transcript was archived either way.",
    };
  }
  return null; // manual compaction: allow, no output needed
}

export function archiveTranscript(payload) {
  const { transcript_path, session_id, trigger } = payload;
  if (!transcript_path || !existsSync(transcript_path)) return null;
  mkdirSync(ARCHIVE_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const dest = join(ARCHIVE_DIR, `${stamp}-${trigger}-${session_id ?? "unknown"}.jsonl`);
  copyFileSync(transcript_path, dest);
  return dest;
}

function main() {
  const payload = JSON.parse(readFileSync(0, "utf8"));

  try {
    archiveTranscript(payload);
  } catch (err) {
    // Archiving is a safety net, not the point of this hook — a failure
    // here must never block a compaction the trigger logic would allow.
    process.stderr.write(`pre-compact archive failed: ${err.message}\n`);
  }

  const result = decide(payload);
  if (result) process.stdout.write(JSON.stringify(result));
  process.exit(0);
}

if (process.argv[2] === "--self-test") {
  console.assert(decide({ trigger: "auto" })?.decision === "block", "auto should block");
  console.assert(decide({ trigger: "manual" }) === null, "manual should not block");
  console.log("pre-compact.mjs self-test passed");
  process.exit(0);
}

main();
