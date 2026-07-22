#!/usr/bin/env node
// Toggle for spec.md §3.10 — flips the marker file
// .claude/hooks/pre-memory-write.mjs checks to decide ask vs. allow for
// memory/ writes. Presence of the file is the whole state; no config format
// needed for a boolean.

import { existsSync, writeFileSync, unlinkSync } from "node:fs";
import { resolve } from "node:path";

const MARKER = resolve(process.cwd(), ".claude/memory-auto-mode");
const USAGE = "usage: memory-auto-mode.mjs <on|off|status>";

function main() {
  const action = process.argv[2];
  if (action === "on") {
    writeFileSync(MARKER, "");
    console.log("auto mode: on — memory/ writes auto-approve and log to memory/audit.log");
  } else if (action === "off") {
    if (existsSync(MARKER)) unlinkSync(MARKER);
    console.log("auto mode: off — memory/ writes go back through the approval dialog");
  } else if (action === "status") {
    console.log(existsSync(MARKER) ? "on" : "off");
  } else {
    console.error(USAGE);
    process.exit(1);
  }
}

main();
