 
/**
 * Phase 3 converter: handwritten harness → Vitest
 *
 * Removes the custom test/assert harness and replaces with Vitest API.
 * Usage: node scripts/convert-handwritten-harness.mjs <batch-file>
 */

import { readFileSync, writeFileSync } from "node:fs";

const batchFile = process.argv[2];
if (!batchFile) { console.error("Usage: node convert-handwritten-harness.mjs <batch-file>"); process.exit(1); }

const files = readFileSync(batchFile, "utf8").trim().split("\n").filter(Boolean);
let converted = 0;

// ── Balanced-paren argument extractor (same as Phase 2 converter) ─────────
function extractArg(src, pos) {
  let depth = 0;
  let i = pos;
  while (i < src.length) {
    const ch = src[i];
    if (ch === "(" || ch === "{" || ch === "[") { depth++; i++; continue; }
    if (ch === ")" || ch === "}" || ch === "]") {
      if (depth === 0) return { arg: src.slice(pos, i).trimEnd(), nextPos: i };
      depth--; i++; continue;
    }
    if (ch === "," && depth === 0) return { arg: src.slice(pos, i).trimEnd(), nextPos: i };
    if (ch === "/" && depth === 0 && src.slice(pos, i).trim() === "") {
      i++;
      while (i < src.length) {
        const rc = src[i];
        if (rc === "/" && (i === 0 || src[i-1] !== "\\")) { i++; break; }
        if (rc === "[") { i++; while (i < src.length && src[i] !== "]") { if (src[i] === "\\") i++; i++; } }
        if (rc === "\\") i++;
        i++;
      }
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      const q = ch; i++;
      while (i < src.length && src[i] !== q) { if (src[i] === "\\") i++; i++; }
      i++; continue;
    }
    i++;
  }
  return { arg: src.slice(pos).trimEnd(), nextPos: src.length };
}

function replaceAll(src, prefix, transformer) {
  let result = "";
  let pos = 0;
  while (true) {
    const idx = src.indexOf(prefix, pos);
    if (idx === -1) { result += src.slice(pos); break; }
    result += src.slice(pos, idx);
    const argsStart = idx + prefix.length;
    const rep = transformer(src, argsStart);
    if (rep === null) { result += prefix; pos = argsStart; }
    else { result += rep.text; pos = rep.endPos; }
  }
  return result;
}

// ── Harness boilerplate patterns to remove ───────────────────────────────
const HARNESS_PATTERNS = [
  // let passed = 0; / let failed = 0;
  /^let\s+passed\s*=\s*0\s*;\s*\n/gm,
  /^let\s+failed\s*=\s*0\s*;\s*\n/gm,
  /^let\s+PASS_COUNT\s*=\s*0\s*;\s*\n/gm,
  /^let\s+FAIL_COUNT\s*=\s*0\s*;\s*\n/gm,
  /^const\s+results\s*:\s*\{[^}]*\}\[\]\s*=\s*\[\]\s*;\s*\n/gm,
  // Trailing summary blocks
  /^\s*console\.log\(\s*['"`]\\n?['"`]\s*\)\s*;\s*\n/gm,
  /^\s*console\.log\(\s*`?\$\{passed\}[^`]*`?\s*\)\s*;\s*\n/gm,
  /^\s*console\.log\(\s*`?\$\{PASS_COUNT\}[^`]*`?\s*\)\s*;\s*\n/gm,
  /^\s*console\.log\(\s*`?\s*\$\{results[^`]*`?\s*\)\s*;\s*\n/gm,
  /^\s*if\s*\(\s*(?:failed|FAIL_COUNT)\s*(?:>|===)\s*\d+\s*\)\s*(?:process\.exit\(\s*1\s*\)|throw[^;]+)\s*;\s*\n?/gm,
  /^\s*process\.exit\(\s*1\s*\)\s*;\s*\n/gm,
  // Summary console.log with various patterns
  /^\s*console\.log\(\s*['"`]={3,}[^]*?['"`]\s*\)\s*;\s*\n/gm,
  /^\s*console\.log\(\s*`?=== Unit Test Summary ===`?\s*\)\s*;\s*\n/gm,
  /^\s*console\.log\(\s*`?\s*PASS:\s*[^`]*`?\s*\)\s*;\s*\n/gm,
  /^\s*console\.log\(\s*`?\s*FAIL:\s*[^`]*`?\s*\)\s*;\s*\n/gm,
  /^\s*console\.log\(\s*`?\s*SKIP:\s*[^`]*`?\s*\)\s*;\s*\n/gm,
];

// ── Multi-line function block remover ─────────────────────────────────────
// Removes a function declaration that starts with the given pattern
function removeFunctionDecl(src, namePattern) {
  const re = new RegExp(`(^|\\n)((?:async\\s+)?function\\s+${namePattern}\\s*\\([^)]*\\)[^{]*\\{)`, "m");
  const match = re.exec(src);
  if (!match) return src;
  const startIdx = match.index + match[1].length;
  let depth = 0;
  let i = startIdx;
  while (i < src.length) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") { depth--; if (depth === 0) { i++; break; } }
    i++;
  }
  // Skip trailing newline
  while (i < src.length && (src[i] === "\n" || src[i] === "\r")) i++;
  return src.slice(0, startIdx) + src.slice(i);
}

// ── Assertion call rewriter ───────────────────────────────────────────────
function rewriteAssertion(src, fnName, mapper) {
  return replaceAll(src, `${fnName}(`, (s, pos) => {
    const { arg: a1, nextPos: p1 } = extractArg(s, pos);
    if (s[p1] !== ",") {
      const text = mapper(a1.trim(), null, null);
      if (text === null) return null;
      return { text, endPos: p1 + 1 };
    }
    const { arg: a2, nextPos: p2 } = extractArg(s, p1 + 1);
    let a3 = null, endPos;
    if (s[p2] === ",") {
      const { arg, nextPos: p3 } = extractArg(s, p2 + 1);
      a3 = arg.trim();
      if (s[p3] === ",") {
        let p4 = p3 + 1;
        while (p4 < s.length && (s[p4] === " " || s[p4] === "\n" || s[p4] === "\r")) p4++;
        endPos = p4 + 1;
      } else {
        endPos = p3 + 1;
      }
    } else {
      endPos = p2 + 1;
    }
    const text = mapper(a1.trim(), a2.trim(), a3);
    if (text === null) return null;
    return { text, endPos };
  });
}


for (const file of files) {
  // Skip the 2 outliers — they need special R-M8 wrapping, handled separately
  if (file.includes("parseContextSwitchCommand.test.ts") ||
      file.includes("scopeResolutionService.test.ts")) {
    console.log(`  skip (outlier): ${file}`);
    continue;
  }

  const orig = readFileSync(file, "utf8");
  let src = orig;

  // ── 1. Detect assertion function names from definitions in this file ────
  const hasFn = (name) => new RegExp(`function\\s+${name}\\s*[<(]`).test(src);
  const hasNodeAssertImport = /import\s+assert\s+from\s*['"]node:assert(?:\/strict)?['"]/.test(src);
  const hasAssert = hasFn("assert(?!Equal|True|False|Deep|Close|Match|Throws|Contains)") || hasNodeAssertImport;
  const hasAssertEqual = hasFn("assert[Ee]qual");
  const hasAssertDeepEqual = hasFn("assertDeepEqual");
  const hasAssertStrictEqual = hasFn("assertStrictEqual");
  const hasAssertTrue = hasFn("assertTrue");
  const hasAssertFalse = hasFn("assertFalse");
  const hasAssertClose = hasFn("assertClose");
  const hasAssertMatch = hasFn("assertMatch");
  const hasAssertContains = hasFn("assertContains");
  const hasAssertThrows = hasFn("assertThrows");
  const hasAssertFailedWith = hasFn("assertFailedWith");

  // ── 2. Detect vitest imports needed ────────────────────────────────────
  const vitestNeeds = new Set(["test", "expect"]);
  // Check for describe/beforeAll/afterAll/beforeEach/afterEach in the file
  // (after harness removal, these would be top-level calls)
  if (/\bdescribe\s*\(/.test(src)) vitestNeeds.add("describe");
  if (/\bbeforeAll\s*\(/.test(src)) vitestNeeds.add("beforeAll");
  if (/\bafterAll\s*\(/.test(src)) vitestNeeds.add("afterAll");
  if (/\bbeforeEach\s*\(/.test(src)) vitestNeeds.add("beforeEach");
  if (/\bafterEach\s*\(/.test(src)) vitestNeeds.add("afterEach");

  // Check if already has vitest import
  if (/from ['"]vitest['"]/.test(src)) {
    console.log(`  skip (already vitest): ${file}`);
    continue;
  }

  // ── 3. Remove harness function declarations ─────────────────────────────
  // Remove node:assert import (both forms)
  src = src.replace(/^import\s+assert\s+from\s*['"]node:assert(?:\/strict)?['"]\s*;?\s*\n/gm, "");
  if (!hasNodeAssertImport) {
    src = removeFunctionDecl(src, "test(?!ing|er|s\\b)");
  }
  if (hasAssert) src = removeFunctionDecl(src, "assert(?!Equal|True|False|Deep|Close|Match|Throws)");
  if (hasAssertEqual) src = removeFunctionDecl(src, "assert[Ee]qual");
  if (hasAssertDeepEqual) src = removeFunctionDecl(src, "assertDeepEqual");
  if (hasAssertStrictEqual) src = removeFunctionDecl(src, "assertStrictEqual");
  if (hasAssertTrue) src = removeFunctionDecl(src, "assertTrue");
  if (hasAssertFalse) src = removeFunctionDecl(src, "assertFalse");
  if (hasAssertClose) src = removeFunctionDecl(src, "assertClose");
  if (hasAssertMatch) src = removeFunctionDecl(src, "assertMatch");
  if (hasAssertContains) src = removeFunctionDecl(src, "assertContains");
  if (hasAssertThrows) src = removeFunctionDecl(src, "assertThrows");
  if (hasAssertFailedWith) src = removeFunctionDecl(src, "assertFailedWith");
  // Also remove runTest helper if present
  src = removeFunctionDecl(src, "runTest");

  // ── 4. Remove boilerplate patterns ──────────────────────────────────────
  for (const re of HARNESS_PATTERNS) src = src.replace(re, "");

  // Remove trailing summary lines: console.log('X passed, Y failed') pattern
  src = src.replace(/^\s*console\.log\(\s*['"`]?\s*\d+\s+passed[^'"`;)]*['"`]?\s*\)\s*;\s*\n?/gm, "");
  src = src.replace(/^\s*console\.log\(`\${passed}[^`]*`\)\s*;\s*\n?/gm, "");
  src = src.replace(/^\s*console\.log\(`\${PASS_COUNT}[^`]*`\)\s*;\s*\n?/gm, "");
  // Generic console.log at module top level with test names/counts
  src = src.replace(/^\s*console\.log\(\s*['"`][^'"`;]*passed[^'"`;]*['"`]\s*\)\s*;\s*\n?/gmi, "");

  // ── 5. Add vitest import ────────────────────────────────────────────────
  const importLine = `import { ${[...vitestNeeds].sort().join(", ")} } from 'vitest';\n`;
  const firstImportIdx = src.search(/^import /m);
  if (firstImportIdx >= 0) {
    src = src.slice(0, firstImportIdx) + importLine + src.slice(firstImportIdx);
  } else {
    // After leading comment block
    const leadingCommentEnd = src.search(/^(?!\/\/|\/\*| \*|\s*$)/m);
    if (leadingCommentEnd >= 0) src = src.slice(0, leadingCommentEnd) + importLine + "\n" + src.slice(leadingCommentEnd);
    else src = importLine + "\n" + src;
  }

  // ── 6. Convert assertion calls ─────────────────────────────────────────
  // Determine names before they were removed from src
  const eqFnName = hasAssertEqual
    ? (/function\s+assertequal\s*[<(]/i.test(orig) && !/function\s+assertEqual\s*[<(]/.test(orig)
        ? "assertequal" : "assertEqual")
    : "assertEqual";

  // For node:assert imports: convert assert.* methods (same table as Phase 2)
  if (hasNodeAssertImport) {
    // Import the Phase 2 balanced-paren rewriteAssert logic inline
    const rewriteAssert2 = (src2, method, mapper) => replaceAll(src2, `assert.${method}(`, (s, pos) => {
      const { arg: a1, nextPos: p1 } = extractArg(s, pos);
      if (s[p1] !== ",") {
        const text = mapper(a1.trim(), null, null);
        if (text === null) return null;
        return { text, endPos: p1 + 1 };
      }
      const { arg: a2, nextPos: p2 } = extractArg(s, p1 + 1);
      let a3 = null, endPos;
      if (s[p2] === ",") {
        const { arg, nextPos: p3 } = extractArg(s, p2 + 1);
        a3 = arg.trim();
        if (s[p3] === ",") {
          let p4 = p3 + 1;
          while (p4 < s.length && (s[p4] === " " || s[p4] === "\n" || s[p4] === "\r")) p4++;
          endPos = p4 + 1;
        } else { endPos = p3 + 1; }
      } else { endPos = p2 + 1; }
      const text = mapper(a1.trim(), a2.trim(), a3);
      if (text === null) return null;
      return { text, endPos };
    });
    src = rewriteAssert2(src, "deepStrictEqual", (a, b, msg) => b === null ? null : (msg ? `expect(${a}, ${msg}).toStrictEqual(${b})` : `expect(${a}).toStrictEqual(${b})`));
    src = rewriteAssert2(src, "deepEqual",       (a, b, msg) => b === null ? null : (msg ? `expect(${a}, ${msg}).toEqual(${b})` : `expect(${a}).toEqual(${b})`));
    src = rewriteAssert2(src, "strictEqual",     (a, b, msg) => b === null ? null : (msg ? `expect(${a}, ${msg}).toBe(${b})` : `expect(${a}).toBe(${b})`));
    src = rewriteAssert2(src, "equal",           (a, b, msg) => b === null ? null : (msg ? `expect(${a}, ${msg}).toBe(${b})` : `expect(${a}).toBe(${b})`));
    src = rewriteAssert2(src, "ok",              (a, _, msg) => msg ? `expect(${a}, ${msg}).toBeTruthy()` : `expect(${a}).toBeTruthy()`);
    src = rewriteAssert2(src, "throws",          (a, b) => {
      if (b === null) return `expect(${a}).toThrow()`;
      if (/^\s*\(/.test(b) || /^\s*(async\s+)?function/.test(b)) return null;
      return `expect(${a}).toThrow(${b})`;
    });
    src = rewriteAssert2(src, "doesNotThrow",    (a) => `expect(${a}).not.toThrow()`);
    src = rewriteAssert2(src, "match",           (a, b) => b === null ? null : `expect(${a}).toMatch(${b})`);
    src = rewriteAssert2(src, "notMatch",        (a, b) => b === null ? null : `expect(${a}).not.toMatch(${b})`);
  }

  // assert(cond, msg) → expect(cond, msg).toBeTruthy()
  if (hasAssert && !hasNodeAssertImport) {
    src = rewriteAssertion(src, "assert", (a, b) => {
      if (b === null) return `expect(${a}).toBeTruthy()`;
      return `expect(${a}, ${b}).toBeTruthy()`;
    });
  }

  // assertTrue(cond, msg) → expect(cond, msg).toBe(true)
  if (hasAssertTrue) {
    src = rewriteAssertion(src, "assertTrue", (a, b) => {
      if (b === null) return `expect(${a}).toBe(true)`;
      return `expect(${a}, ${b}).toBe(true)`;
    });
  }

  // assertFalse(cond, msg) → expect(cond, msg).toBe(false)
  if (hasAssertFalse) {
    src = rewriteAssertion(src, "assertFalse", (a, b) => {
      if (b === null) return `expect(${a}).toBe(false)`;
      return `expect(${a}, ${b}).toBe(false)`;
    });
  }

  // assertEqual(actual, expected, label?) → expect(actual).toEqual(expected)
  // Use toBe for primitive-like expected values (string/number/boolean literals)
  if (hasAssertEqual) {
    src = rewriteAssertion(src, eqFnName, (a, b, label) => {
      if (b === null) return null;
      // Use toBe for primitives, toEqual for complex
      const isPrimitive = /^(['"`].*['"`]|\d[\d.]*|true|false|null|undefined|-\d)$/.test(b.trim());
      const matcher = isPrimitive ? "toBe" : "toEqual";
      const msgPart = label ? `, ${label}` : "";
      return `expect(${a}${msgPart}).${matcher}(${b})`;
    });
  }

  // assertDeepEqual(actual, expected) → expect(actual).toStrictEqual(expected)
  if (hasAssertDeepEqual) {
    src = rewriteAssertion(src, "assertDeepEqual", (a, b, label) => {
      if (b === null) return null;
      return label ? `expect(${a}, ${label}).toStrictEqual(${b})` : `expect(${a}).toStrictEqual(${b})`;
    });
  }

  // assertStrictEqual(actual, expected) → expect(actual).toBe(expected)
  if (hasAssertStrictEqual) {
    src = rewriteAssertion(src, "assertStrictEqual", (a, b) => b === null ? null : `expect(${a}).toBe(${b})`);
  }

  // assertClose(actual, expected, label, tolerance?) — use toBeCloseTo
  if (hasAssertClose) {
    src = rewriteAssertion(src, "assertClose", (a, b) => {
      if (b === null) return null;
      return `expect(${a}).toBeCloseTo(${b}, 4)`;
    });
  }

  // assertMatch(str, rx) → expect(str).toMatch(rx)
  if (hasAssertMatch) {
    src = rewriteAssertion(src, "assertMatch", (a, b) => b === null ? null : `expect(${a}).toMatch(${b})`);
  }

  // assertContains(arr, item) → expect(arr).toContain(item)
  if (hasAssertContains) {
    src = rewriteAssertion(src, "assertContains", (a, b) => b === null ? null : `expect(${a}).toContain(${b})`);
  }

  // ── 7. Wrap top-level scripts in a test() block if no test() calls exist ─
  // Files that were top-level assert scripts (no function test() harness)
  // need their assertions wrapped in at least one test() block.
  if (!hasNodeAssertImport && !src.includes("test(") && src.includes("expect(")) {
    // Wrap all non-import, non-comment, non-blank lines in a test block
    const lines = src.split("\n");
    const importEnd = lines.reduce((last, line, i) => line.startsWith("import ") ? i : last, -1);
    const bodyLines = lines.slice(importEnd + 1);
    const body = bodyLines.join("\n").trim();
    if (body) {
      src = lines.slice(0, importEnd + 1).join("\n") + "\n\n" +
            `test('assertions', () => {\n${body.split("\n").map(l => "  " + l).join("\n")}\n});\n`;
    }
  } else if (hasNodeAssertImport && !src.includes("test(") && src.includes("expect(")) {
    // Top-level script that used node:assert — wrap in a test block
    const lines = src.split("\n");
    const importEnd = lines.reduce((last, line, i) => line.startsWith("import ") ? i : last, -1);
    const bodyLines = lines.slice(importEnd + 1);
    const body = bodyLines.join("\n").trim();
    if (body) {
      src = lines.slice(0, importEnd + 1).join("\n") + "\n\n" +
            `test('assertions', () => {\n${body.split("\n").map(l => "  " + l).join("\n")}\n});\n`;
    }
  }

  // ── 8. Clean up extra blank lines left by boilerplate removal ──────────
  src = src.replace(/\n{3,}/g, "\n\n");

  if (src !== orig) {
    writeFileSync(file, src);
    console.log(`✓ converted: ${file}`);
    converted++;
  } else {
    console.log(`  unchanged: ${file}`);
  }
}

console.log(`\nConverted ${converted} / ${files.length} files.`);
