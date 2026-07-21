// Minimal frontmatter read/write — shared by memory-toggle.mjs and
// memory-snapshot.mjs. Only handles flat top-level `key: value` lines
// (nested blocks like `metadata:` are passed through untouched); that's
// all §3.3/§3.5 need (status, pinned), so a real YAML parser is skipped.

export function readFrontmatter(text) {
  const match = text.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!match) return null;
  return { raw: match[1], end: match[0].length };
}

export function getField(raw, key) {
  const line = raw.split("\n").find((l) => l.startsWith(`${key}:`));
  return line ? line.slice(key.length + 1).trim() : undefined;
}

export function setField(text, key, value) {
  const fm = readFrontmatter(text);
  if (!fm) throw new Error("no frontmatter block found");
  const lines = fm.raw.split("\n");
  const idx = lines.findIndex((l) => l.startsWith(`${key}:`));
  const line = `${key}: ${value}`;
  if (idx >= 0) lines[idx] = line;
  else lines.push(line);
  return `---\n${lines.join("\n")}\n---\n${text.slice(fm.end)}`;
}
