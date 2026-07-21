#!/usr/bin/env node
// Export / snapshot (§3.9) — freezes exactly which memory files were
// active, full content included, at this moment. Mirrors acm2-browser's
// SheetExport and reuses compaction-archive/'s gitignored-timestamped-file
// pattern from the §3.7 hook. Pinned status isn't filtered on — pinning
// (§3.5) only exempts a memory from relevance-pruning, it says nothing
// about whether it belongs in an export.

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getField, readFrontmatter } from "./frontmatter.mjs";

const MEMORY_DIR = join(process.cwd(), "memory");
const SNAPSHOT_DIR = join(process.cwd(), "memory-snapshots");

export function activeMemoryFiles(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".md"))
    .filter((f) => {
      const fm = readFrontmatter(readFileSync(join(dir, f), "utf8"));
      return (fm && getField(fm.raw, "status")) !== "inactive"; // no field = active
    });
}

export function buildSnapshot(dir) {
  const files = activeMemoryFiles(dir);
  const parts = [
    `# Memory snapshot — ${new Date().toISOString()}`,
    "",
    `${files.length} active memory file(s).`,
  ];
  for (const f of files) parts.push("", `## ${f}`, "", readFileSync(join(dir, f), "utf8").trim());
  return parts.join("\n") + "\n";
}

function main() {
  mkdirSync(SNAPSHOT_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const dest = join(SNAPSHOT_DIR, `${stamp}.md`);
  writeFileSync(dest, buildSnapshot(MEMORY_DIR));
  console.log(`wrote ${dest}`);
}

if (process.argv[2] === "--self-test") {
  console.assert(buildSnapshot(MEMORY_DIR).includes("active memory file(s)."), "should render header");
  console.log("memory-snapshot.mjs self-test passed");
  process.exit(0);
}

main();
