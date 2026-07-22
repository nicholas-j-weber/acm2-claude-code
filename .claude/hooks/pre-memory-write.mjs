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
//
// Auto mode (spec.md §3.10): if .claude/memory-auto-mode exists, this
// swaps "ask" for "allow" and appends an entry to memory/audit.log instead
// — a written record traded for the approval pause. Off by default.

import { readFileSync, existsSync, appendFileSync } from "node:fs";
import { resolve, sep, relative } from "node:path";

const MEMORY_DIR = resolve(process.cwd(), "memory") + sep;
const AUTO_MODE_MARKER = resolve(process.cwd(), ".claude/memory-auto-mode");
const AUDIT_LOG = resolve(process.cwd(), "memory/audit.log");

export function decide(payload, { autoMode = false } = {}) {
  const path = payload?.tool_input?.file_path;
  if (!path) return null;
  if (!resolve(path).startsWith(MEMORY_DIR)) return null;
  if (autoMode) {
    return {
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "allow",
        permissionDecisionReason:
          "ACM2 auto mode: write to memory/ auto-approved and logged to memory/audit.log (spec.md §3.10).",
      },
    };
  }
  return {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "ask",
      permissionDecisionReason:
        "ACM2 prototype: this write targets memory/, so it's surfaced for approval instead of landing silently (spec.md §3.1).",
    },
  };
}

function appendAuditLog(payload) {
  const entry = {
    ts: new Date().toISOString(),
    tool: payload.tool_name ?? "unknown",
    file: relative(MEMORY_DIR, resolve(payload.tool_input.file_path)),
    tool_input: payload.tool_input,
  };
  appendFileSync(AUDIT_LOG, JSON.stringify(entry) + "\n");
}

function main() {
  const payload = JSON.parse(readFileSync(0, "utf8"));
  const autoMode = existsSync(AUTO_MODE_MARKER);
  const result = decide(payload, { autoMode });
  if (result && autoMode) appendAuditLog(payload);
  if (result) process.stdout.write(JSON.stringify(result));
  process.exit(0);
}

if (process.argv[2] === "--self-test") {
  console.assert(
    decide({ tool_input: { file_path: resolve(process.cwd(), "memory/foo.md") } })
      ?.hookSpecificOutput.permissionDecision === "ask",
    "memory/ writes should ask by default",
  );
  console.assert(
    decide(
      { tool_input: { file_path: resolve(process.cwd(), "memory/foo.md") } },
      { autoMode: true },
    )?.hookSpecificOutput.permissionDecision === "allow",
    "memory/ writes should auto-allow in auto mode",
  );
  console.assert(
    decide(
      { tool_input: { file_path: resolve(process.cwd(), "spec.md") } },
      { autoMode: true },
    ) === null,
    "non-memory writes should pass through even in auto mode",
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
