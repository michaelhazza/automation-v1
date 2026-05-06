import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const EXCLUDED = new Set(["node_modules","dist",".git","coverage","tools","worker","migrations",".github",".claude"]);

function walk(dir, files = []) {
  for (const e of readdirSync(dir)) {
    if (EXCLUDED.has(e)) continue;
    const full = join(dir, e);
    if (statSync(full).isDirectory()) walk(full, files);
    else if (e.endsWith(".test.ts")) files.push(full.replace(/\\/g, "/").replace(/^\.\//, ""));
  }
  return files;
}

const walkerFiles = new Set(walk("."));

// Parse bash runner discoveries from snapshot
import { readFileSync } from "node:fs";
const txt = readFileSync("docs/pre-migration-test-snapshot.txt", "utf8");
const bashFiles = new Set();
for (const line of txt.split("\n")) {
  const m = line.match(/^\[(PASS|FAIL|SKIP)\] (.+\.test\.ts)$/);
  if (m) bashFiles.add(m[2].replace(/^\.\//, ""));
}

console.log("walker:", walkerFiles.size, "bash:", bashFiles.size);

// Files in bash but not walker (under excluded dirs or missed)
const bashNotWalker = [...bashFiles].filter(f => !walkerFiles.has(f)).sort();
console.log("\nIn bash but NOT in walker:");
bashNotWalker.forEach(f => console.log(" ", f));

// Files in walker but not bash (outliers)
const walkerNotBash = [...walkerFiles].filter(f => !bashFiles.has(f)).sort();
console.log("\nIn walker but NOT in bash (should be outliers):");
walkerNotBash.forEach(f => console.log(" ", f));
