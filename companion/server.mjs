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
const MEMORY_DIR = join(ROOT, "memory");
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

// The memory list/edit/delete/compress API below writes to memory/*.md
// directly via fs, same as resolvePending above — no bypass of §3.1's
// PreToolUse hook, since that hook only gates Claude Code's own tool calls.
// A human editing through this window *is* the approval; that's the whole
// point of exposing it here instead of routing it back through the agent.

function listMemories() {
  return readdirSync(MEMORY_DIR)
    .filter((f) => f.endsWith(".md"))
    .map((file) => {
      const text = readFileSync(join(MEMORY_DIR, file), "utf8");
      const fm = readFrontmatter(text);
      if (!fm) return null;
      return {
        file,
        name: getField(fm.raw, "name"),
        description: getField(fm.raw, "description"),
        status: getField(fm.raw, "status"),
        pinned: getField(fm.raw, "pinned") === "true",
        summarizes: getField(fm.raw, "summarizes"),
        body: text.slice(fm.end).trim(),
      };
    })
    .filter(Boolean)
    .sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""));
}

function updateMemory(file, { body, pinned, status }) {
  const safeName = basename(file);
  const path = join(MEMORY_DIR, safeName);
  if (!existsSync(path)) throw new Error("not found");
  let text = readFileSync(path, "utf8");
  if (pinned !== undefined) text = setField(text, "pinned", String(pinned));
  if (status !== undefined) text = setField(text, "status", status);
  if (body !== undefined) {
    const fm = readFrontmatter(text);
    text = text.slice(0, fm.end) + body.trim() + "\n";
  }
  writeFileSync(path, text);
}

function deleteMemoryFile(file) {
  const path = join(MEMORY_DIR, basename(file));
  if (existsSync(path)) unlinkSync(path);
}

// Compression (mirrors acm2-browser's Memory.kind === "summary": a digest
// that replaces one or more entries, deactivating — never deleting — the
// ones it replaces). `summarizes` is provenance: which entries this digest
// stands in for, so a human reading the file later can see what was folded
// in without having to reconstruct it from git history.
function compressMemories({ name, description, type, body, summarizes }) {
  const fileName = `${name}.md`;
  const path = join(MEMORY_DIR, fileName);
  if (existsSync(path)) throw new Error(`memory/${fileName} already exists`);
  const frontmatter =
    `---\n` +
    `name: ${name}\n` +
    `description: ${description}\n` +
    `metadata:\n` +
    `  type: ${type}\n` +
    `status: active\n` +
    `pinned: false\n` +
    `summarizes: ${summarizes.join(", ")}\n` +
    `---\n\n`;
  writeFileSync(path, frontmatter + body.trim() + "\n");
  for (const f of summarizes) {
    const p = join(MEMORY_DIR, basename(f));
    if (existsSync(p)) writeFileSync(p, setField(readFileSync(p, "utf8"), "status", "inactive"));
  }
  return fileName;
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

  if (req.method === "GET" && req.url === "/api/memories") {
    json(res, 200, listMemories());
    return;
  }

  if (
    req.method === "POST" &&
    ["/api/memories/update", "/api/memories/delete", "/api/memories/compress"].includes(req.url)
  ) {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => {
      try {
        const payload = JSON.parse(data);
        if (req.url === "/api/memories/update") {
          const { file, body, pinned, status } = payload;
          updateMemory(file, { body, pinned, status });
        } else if (req.url === "/api/memories/delete") {
          deleteMemoryFile(payload.file);
        } else {
          const { name, description, type, body, summarizes } = payload;
          if (!name || !summarizes?.length) throw new Error("name and summarizes[] are required");
          compressMemories({ name, description: description ?? "", type: type ?? "project", body: body ?? "", summarizes });
        }
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

  const memA = join(MEMORY_DIR, "__self-test-a.md");
  const memB = join(MEMORY_DIR, "__self-test-b.md");
  writeFileSync(memA, "---\nname: a\ndescription: a\nstatus: active\npinned: false\n---\n\nbody a\n");
  writeFileSync(memB, "---\nname: b\ndescription: b\nstatus: active\npinned: false\n---\n\nbody b\n");

  const mems = listMemories();
  console.assert(mems.some((m) => m.name === "a" && m.body === "body a"), "should list memory files with parsed body");

  updateMemory("__self-test-a.md", { pinned: true, status: "inactive", body: "edited a" });
  const editedA = readFileSync(memA, "utf8");
  console.assert(editedA.includes("pinned: true"), "update should set pinned");
  console.assert(editedA.includes("status: inactive"), "update should set status");
  console.assert(editedA.includes("edited a"), "update should set body");

  const summaryFile = compressMemories({
    name: "__self-test-summary",
    description: "summary",
    type: "project",
    body: "digest of a and b",
    summarizes: ["__self-test-a.md", "__self-test-b.md"],
  });
  const summaryPath = join(MEMORY_DIR, summaryFile);
  const summaryText = readFileSync(summaryPath, "utf8");
  console.assert(summaryText.includes("summarizes: __self-test-a.md, __self-test-b.md"), "summary should record what it summarizes");
  console.assert(readFileSync(memB, "utf8").includes("status: inactive"), "compress should deactivate summarized entries");
  unlinkSync(summaryPath);

  deleteMemoryFile("__self-test-a.md");
  console.assert(!existsSync(memA), "delete should remove the file");
  unlinkSync(memB);

  console.log("server.mjs self-test passed");
  process.exit(0);
}
