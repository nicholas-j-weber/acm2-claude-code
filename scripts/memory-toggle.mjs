#!/usr/bin/env node
// On/off without delete (§3.3) and pinning as a floor (§3.5) — same
// mechanism, flip one frontmatter field, so one script does both rather
// than duplicating the read/write/print flow twice. Deletion is never an
// option here: turning a memory off just sets `status: inactive`, and git
// history (this file is meant to be committed) is the non-destructive
// revert/audit trail §3.6 would otherwise have to build from scratch.

import { readFileSync, writeFileSync } from "node:fs";
import { setField } from "./frontmatter.mjs";

const USAGE = "usage: memory-toggle.mjs <file> <on|off|pin|unpin>";

const ACTIONS = {
  on: { field: "status", value: "active" },
  off: { field: "status", value: "inactive" },
  pin: { field: "pinned", value: "true" },
  unpin: { field: "pinned", value: "false" },
};

export function apply(text, action) {
  const spec = ACTIONS[action];
  if (!spec) throw new Error(USAGE);
  return setField(text, spec.field, spec.value);
}

function main() {
  const [file, action] = process.argv.slice(2);
  if (!file || !ACTIONS[action]) {
    console.error(USAGE);
    process.exit(1);
  }
  writeFileSync(file, apply(readFileSync(file, "utf8"), action));
  console.log(`${file}: ${action}`);
}

if (process.argv[2] === "--self-test") {
  const sample = "---\nname: foo\nstatus: active\n---\nbody\n";
  console.assert(apply(sample, "off").includes("status: inactive"), "off should set inactive");
  console.assert(apply(sample, "on").includes("status: active"), "on should set active");
  console.assert(apply(sample, "pin").includes("pinned: true"), "pin should add pinned field");
  console.assert(apply(sample, "unpin").includes("pinned: false"), "unpin should add pinned field");
  console.log("memory-toggle.mjs self-test passed");
  process.exit(0);
}

main();
