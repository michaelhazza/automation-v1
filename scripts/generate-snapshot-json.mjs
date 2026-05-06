import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const txt = readFileSync("docs/pre-migration-test-snapshot.txt", "utf8");
const outcomeMap = new Map();
for (const line of txt.split("\n")) {
  const m = line.match(/^(\S+\.test\.ts)\t(pass|fail|skip)$/);
  if (m) outcomeMap.set(m[1], m[2]);
}

// Path-prefixes to skip (mirrors vitest.config.ts exclude list).
// Use path prefix matching to avoid excluding server/tools/ when only
// top-level tools/mission-control is excluded.
const EXCLUDED_NAME_ANY = new Set(["node_modules", "dist", ".git", "coverage", "migrations", ".github", ".claude"]);
const EXCLUDED_PATH_PREFIX = ["tools/mission-control/", "worker/"];

function walk(dir, files = [], relBase = ".") {
  for (const entry of readdirSync(dir)) {
    if (EXCLUDED_NAME_ANY.has(entry)) continue;
    const full = join(dir, entry);
    const rel = full.replace(/\\/g, "/").replace(/^\.\//, "");
    if (EXCLUDED_PATH_PREFIX.some(p => rel.startsWith(p))) continue;
    const st = statSync(full);
    if (st.isDirectory()) walk(full, files, relBase);
    else if (entry.endsWith(".test.ts")) files.push(rel);
  }
  return files;
}
const allTestFiles = walk(".");

const entries = allTestFiles.map(file => {
  const src = readFileSync(file, "utf8");
  const testCount =
    (src.match(/\btest\s*\(/g) || []).length +
    (src.match(/\bdescribe\s*\(/g) || []).length;
  const outcome = outcomeMap.get(file) ?? "not-discovered";
  return { file, outcome, testCount };
});

writeFileSync(
  "docs/pre-migration-test-snapshot.json",
  JSON.stringify(entries, null, 2) + "\n"
);
console.log(`Wrote ${entries.length} entries`);
