#!/usr/bin/env node
// §3.6's Version record is git log on memory/ — this just saves typing the
// git incantation. No history is built or stored here; it's a thin wrapper
// over `git log -p`, nothing more.

import { execFileSync } from "node:child_process";

function main() {
  const [file] = process.argv.slice(2);
  const target = file ? `memory/${file}` : "memory/";
  const args = ["log", "-p", "--follow", "--", target];
  try {
    console.log(execFileSync("git", args, { encoding: "utf8" }));
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}

main();
