import { readFileSync, writeFileSync } from "node:fs";

const grep = JSON.parse(readFileSync("docs/pre-migration-test-snapshot.json", "utf8"));
const vitestRaw = JSON.parse(readFileSync("tasks/builds/vitest-migration/vitest-discovery-baseline.json", "utf8"));

const grepMap = new Map(grep.map(e => [e.file, e.testCount]));
const vitestMap = new Map();

const entries = vitestRaw.testResults || [];
for (const e of entries) {
  const path = (e.name || e.filepath || "").replace(/\\/g, "/").replace(/^.*automation-v1\//, "");
  if (!path) continue;
  const tests = e.assertionResults || e.tests || [];
  vitestMap.set(path, tests.length);
}

const all = new Set([...grepMap.keys(), ...vitestMap.keys()]);
let match = 0, delta = 0, mismatch = 0;
const lines = [];
for (const f of [...all].sort()) {
  const g = grepMap.get(f) ?? 0;
  const v = vitestMap.get(f) ?? 0;
  let status;
  if (g === v) { status = "MATCH"; match++; }
  else if (g === 0 && v > 0) { status = "OUTLIER (Vitest only)"; delta++; }
  else if (Math.abs(g - v) <= Math.max(1, g * 0.1)) { status = "WHITELISTED DELTA"; delta++; }
  else { status = "MISMATCH"; mismatch++; }
  lines.push(`${f}\tgrep:${g}\tvitest:${v}\t${status}`);
}

const out =
  `# Test-count parity (Phase 1)\n\n` +
  `Compares grep-derived testCount (docs/pre-migration-test-snapshot.json)\n` +
  `against Vitest discovery (tasks/builds/vitest-migration/vitest-discovery-baseline.json).\n\n` +
  `Note: At Phase 1, Vitest sees 0 registered tests for all files because they\n` +
  `use handwritten harnesses or node:test — conversion happens in Phases 2-3.\n` +
  `MISMATCH here means grep counts > 0 but Vitest counts 0; this is expected\n` +
  `for all unconverted files and will be resolved file-by-file in Phase 2-3.\n\n` +
  `Summary: MATCH=${match}, DELTA/OUTLIER=${delta}, MISMATCH=${mismatch}\n\n` +
  `## Per-file\n\n` +
  lines.join("\n") + "\n";

writeFileSync("tasks/builds/vitest-migration/test-count-parity.md", out);
console.log(`MATCH=${match}, DELTA=${delta}, MISMATCH=${mismatch}`);
