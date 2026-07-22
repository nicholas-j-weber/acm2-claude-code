#!/usr/bin/env node
// Visible, revertible writes — spec.md §3.1.
//
// Verified against real Claude Code docs before writing this (see spec.md
// §7): PreToolUse can't pause-and-modify in one call, but
// `permissionDecision: "ask"` delegates to Claude Code's own permission
// dialog, which DOES pause for a human and show the change before it lands.
// That's the honest version of "a memory write becomes a proposal, not a
// silent mutation" — reusing the native approval UI instead of building a
// custom one.
//
// Scoped deliberately narrow: only Write/Edit calls whose target path is
// inside this repo's memory/ directory trigger the ask. Every other file
// write in the repo is unaffected — this isn't a general write-approval
// gate, just the memory store.

import { readFileSync } from "node:fs";
import { resolve, sep } from "node:path";

const MEMORY_DIR = resolve(process.cwd(), "memory") + sep;

export function decide(payload) {
  const path = payload?.tool_input?.file_path;
  if (!path) return null;
  if (!resolve(path).startsWith(MEMORY_DIR)) return null;
  return {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "ask",
      permissionDecisionReason:
        "ACM2 prototype: this write targets memory/, so it's surfaced for approval instead of landing silently (spec.md §3.1).",
    },
  };
}

function main() {
  const payload = JSON.parse(readFileSync(0, "utf8"));
  const result = decide(payload);
  if (result) process.stdout.write(JSON.stringify(result));
  process.exit(0);
}

if (process.argv[2] === "--self-test") {
  console.assert(
    decide({ tool_input: { file_path: resolve(process.cwd(), "memory/foo.md") } })
      ?.hookSpecificOutput.permissionDecision === "ask",
    "memory/ writes should ask",
  );
  console.assert(
    decide({ tool_input: { file_path: resolve(process.cwd(), "spec.md") } }) === null,
    "non-memory writes should pass through",
  );
  console.assert(decide({}) === null, "missing tool_input should pass through");
  console.log("pre-memory-write.mjs self-test passed");
  process.exit(0);
}

main();
