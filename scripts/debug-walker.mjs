import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const EXCLUDED = new Set(["node_modules","dist",".git","coverage","tools","worker","migrations",".github",".claude"]);

function walk(dir, files = []) {
  for (const e of readdirSync(dir)) {
    if (EXCLUDED.has(e)) continue;
    const full = join(dir, e);
    if (statSync(full).isDirectory()) walk(full, files);
    else if (e.endsWith(".test.ts")) files.push(full.replace(/\\/g, "/"));
  }
  return files;
}

const files = walk(".");
console.log("walker total:", files.length);
console.log("outliers:", files.filter(f => f.includes("parseContextSwitch") || f.includes("scopeResolutionService.test")));
