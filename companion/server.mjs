#!/usr/bin/env node
// The companion window's bridge server — spec.md §4.2/§4.3.
//
// Built-ins only (http, fs, path), no framework, no dependency: this is a
// directory listing, a textarea, and a save button. Poll-based on purpose —
// §3.7 already established hooks can't push to an external process, so
// there's no live channel to build toward.

import { createServer } from "node:http";
import { readFileSync, readdirSync, writeFileSync, unlinkSync, mkdirSync, existsSync } from "node:fs";
import { join, basename, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { readFrontmatter, getField, setField } from "../scripts/frontmatter.mjs";

const PORT = 4317;
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PENDING_DIR = join(ROOT, "memory", "pending");
const RESOLVED_DIR = join(ROOT, "memory", "resolved");
const INDEX_HTML = join(dirname(fileURLToPath(import.meta.url)), "index.html");

for (const dir of [PENDING_DIR, RESOLVED_DIR]) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function listPending() {
  return readdirSync(PENDING_DIR)
    .filter((f) => f.endsWith(".md"))
    .map((file) => {
      const text = readFileSync(join(PENDING_DIR, file), "utf8");
      const fm = readFrontmatter(text);
      if (!fm) return null;
      return {
        file,
        kind: getField(fm.raw, "kind"),
        session_id: getField(fm.raw, "session_id"),
        created: getField(fm.raw, "created"),
        status: getField(fm.raw, "status"),
        supersedes_range: getField(fm.raw, "supersedes_range"),
        body: text.slice(fm.end).trim(),
      };
    })
    .filter(Boolean)
    .sort((a, b) => (a.created ?? "").localeCompare(b.created ?? ""));
}

function resolvePending(file, newBody) {
  const safeName = basename(file);
  const path = join(PENDING_DIR, safeName);
  if (!existsSync(path)) throw new Error("not found");

  const original = readFileSync(path, "utf8");
  const withStatus = setField(original, "status", "resolved");
  const fm = readFrontmatter(withStatus);
  const final = withStatus.slice(0, fm.end) + newBody.trim() + "\n";

  writeFileSync(join(RESOLVED_DIR, safeName), final);
  unlinkSync(path);
}

function json(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

const server = createServer((req, res) => {
  if (req.method === "GET" && req.url === "/") {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(readFileSync(INDEX_HTML));
    return;
  }

  if (req.method === "GET" && req.url === "/api/pending") {
    json(res, 200, listPending());
    return;
  }

  if (req.method === "POST" && req.url === "/api/resolve") {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => {
      try {
        const { file, body } = JSON.parse(data);
        resolvePending(file, body ?? "");
        json(res, 200, { ok: true });
      } catch (err) {
        json(res, 400, { ok: false, error: err.message });
      }
    });
    return;
  }

  res.writeHead(404);
  res.end();
});

if (process.argv[2] !== "--self-test") {
  server.listen(PORT, () => {
    console.log(`companion window serving http://localhost:${PORT}`);
  });
}

if (process.argv[2] === "--self-test") {
  const tmpFile = join(PENDING_DIR, "__self-test.md");
  writeFileSync(
    tmpFile,
    "---\nkind: compaction-checkpoint\nsession_id: test\ncreated: 2026-01-01T00:00:00Z\nstatus: pending\n---\n\noriginal body\n",
  );
  const listed = listPending();
  console.assert(listed.some((p) => p.file === "__self-test.md" && p.body === "original body"), "should list pending file with parsed body");

  resolvePending("__self-test.md", "edited body");
  console.assert(!existsSync(tmpFile), "resolved file should be removed from pending/");
  const resolvedText = readFileSync(join(RESOLVED_DIR, "__self-test.md"), "utf8");
  console.assert(resolvedText.includes("status: resolved"), "resolved file should have status flipped");
  console.assert(resolvedText.includes("edited body"), "resolved file should have the edited body");
  unlinkSync(join(RESOLVED_DIR, "__self-test.md"));

  console.log("server.mjs self-test passed");
  process.exit(0);
}
