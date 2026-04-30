/**
 * Mechanical converter: node:test + node:assert → vitest
 *
 * Uses balanced-parenthesis extraction to correctly handle function calls
 * with multiple arguments (e.g. assert.equal(fn(a, b), expected)).
 */

import { readFileSync, writeFileSync } from "node:fs";

const batchFile = process.argv[2];
if (!batchFile) { console.error("Usage: node convert-node-test-batch.mjs <batch-file>"); process.exit(1); }

const files = readFileSync(batchFile, "utf8").trim().split("\n").filter(Boolean);
let converted = 0;

// ── Balanced-parenthesis argument extractor ────────────────────────────────
// Extracts the first comma-separated argument from src starting at `pos`
// (pos points to the character right after the opening paren of the call).
// Returns { arg: string, nextPos: number } where nextPos is the position of
// the comma or closing paren that ended the argument.
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
    // Skip string literals
    if (ch === '"' || ch === "'" || ch === "`") {
      const q = ch; i++;
      while (i < src.length && src[i] !== q) { if (src[i] === "\\") i++; i++; }
      i++; continue;
    }
    // Skip regex literals (heuristic: / when everything seen so far is whitespace)
    // Only activate when depth=0 to avoid false positives inside expressions
    if (ch === "/" && depth === 0 && src.slice(pos, i).trim() === "") {
      i++; // skip opening /
      while (i < src.length) {
        const rc = src[i];
        if (rc === "/" && (i === 0 || src[i-1] !== "\\")) { i++; break; } // closing /
        if (rc === "[") { // character class — scan to ]
          i++;
          while (i < src.length && src[i] !== "]") { if (src[i] === "\\") i++; i++; }
        }
        if (rc === "\\") i++; // escaped char
        i++;
      }
      continue;
    }
    i++;
  }
  return { arg: src.slice(pos).trimEnd(), nextPos: src.length };
}

// Rewrite all occurrences of `prefix(args...)` where prefix is like `assert.equal(`
// transformer receives (src, openParenPos) and returns the replacement string
// or null if no replacement should be made.
function replaceAll(src, literalPrefix, transformer) {
  let result = "";
  let pos = 0;
  while (true) {
    const idx = src.indexOf(literalPrefix, pos);
    if (idx === -1) { result += src.slice(pos); break; }
    result += src.slice(pos, idx);
    const argsStart = idx + literalPrefix.length;
    const replacement = transformer(src, argsStart);
    if (replacement === null) { result += literalPrefix; pos = argsStart; }
    else { result += replacement.text; pos = replacement.endPos; }
  }
  return result;
}

// ── assert.METHOD(firstArg, secondArg, ...rest) rewriter ──────────────────
function rewriteAssert(src, method, mapper) {
  return replaceAll(src, `assert.${method}(`, (s, pos) => {
    const { arg: a1, nextPos: p1 } = extractArg(s, pos);
    if (s[p1] !== ",") {
      // single-arg form
      const text = mapper(a1, null, null);
      if (text === null) return null;
      return { text, endPos: p1 + 1 }; // skip the closing paren
    }
    const { arg: a2, nextPos: p2 } = extractArg(s, p1 + 1);
    // optional third arg (message)
    let a3 = null, endPos;
    if (s[p2] === ",") {
      const { arg, nextPos: p3 } = extractArg(s, p2 + 1);
      a3 = arg.trim();
      // Handle trailing comma: if p3 is a comma, skip to the closing paren
      if (s[p3] === ",") {
        // trailing comma — find the closing paren
        let p4 = p3 + 1;
        while (p4 < s.length && (s[p4] === " " || s[p4] === "\n" || s[p4] === "\r")) p4++;
        endPos = p4 + 1; // skip the closing paren
      } else {
        endPos = p3 + 1; // skip closing paren
      }
    } else {
      endPos = p2 + 1; // skip closing paren
    }
    const text = mapper(a1.trim(), a2.trim(), a3);
    if (text === null) return null;
    return { text, endPos };
  });
}

// Build expect(a, msg?) matchers
function expectMsg(a, msg) { return msg ? `expect(${a}, ${msg})` : `expect(${a})`; }

for (const file of files) {
  const orig = readFileSync(file, "utf8");
  let src = orig;

  // ─── 1. Imports ──────────────────────────────────────────────────────────
  const vitestImports = new Set();
  if (/import\s+test\s+from\s*['"]node:test['"]/.test(src)) vitestImports.add("test");
  const nt = src.match(/import\s*\{([^}]+)\}\s*from\s*['"]node:test['"]/);
  if (nt) for (const n of nt[1].split(",").map(s=>s.trim())) {
    vitestImports.add(n === "mock" ? "vi" : n);
  }
  if (/import\s+assert\s+from\s*['"]node:assert\/strict['"]/.test(src) ||
      /import\s*\{\s*strict\s+as\s+assert\s*\}\s*from\s*['"]node:assert['"]/.test(src)) {
    vitestImports.add("expect");
  }

  src = src.replace(/^import\s+test\s+from\s*['"]node:test['"]\s*;?\s*\n/gm, "");
  src = src.replace(/^import\s*\{[^}]+\}\s*from\s*['"]node:test['"]\s*;?\s*\n/gm, "");
  src = src.replace(/^import\s+assert\s+from\s*['"]node:assert\/strict['"]\s*;?\s*\n/gm, "");
  src = src.replace(/^import\s*\{\s*strict\s+as\s+assert\s*\}\s*from\s*['"]node:assert['"]\s*;?\s*\n/gm, "");

  // Also add 'test' if the file uses test() calls but didn't import it from node:test
  // (node:test provides test as an implicit global when run via tsx)
  if (!vitestImports.has("test") && /\btest\s*\(/.test(src)) {
    vitestImports.add("test");
  }
  if (vitestImports.size > 0) {
    const importLine = `import { ${[...vitestImports].sort().join(", ")} } from 'vitest';\n`;
    const firstImportIdx = src.search(/^import /m);
    if (firstImportIdx >= 0) src = src.slice(0, firstImportIdx) + importLine + src.slice(firstImportIdx);
    else src = importLine + src;
  }

  // ─── 2. assert.* conversions (balanced extraction) ───────────────────────
  src = rewriteAssert(src, "deepStrictEqual", (a, b, msg) => b === null ? null : `${expectMsg(a, msg)}.toStrictEqual(${b})`);
  src = rewriteAssert(src, "deepEqual",       (a, b, msg) => b === null ? null : `${expectMsg(a, msg)}.toEqual(${b})`);
  src = rewriteAssert(src, "strictEqual",     (a, b, msg) => b === null ? null : `${expectMsg(a, msg)}.toBe(${b})`);
  src = rewriteAssert(src, "equal",           (a, b, msg) => b === null ? null : `${expectMsg(a, msg)}.toBe(${b})`);
  src = rewriteAssert(src, "notStrictEqual",  (a, b, msg) => b === null ? null : `${expectMsg(a, msg)}.not.toBe(${b})`);
  src = rewriteAssert(src, "notEqual",        (a, b, msg) => b === null ? null : `${expectMsg(a, msg)}.not.toBe(${b})`);
  src = rewriteAssert(src, "notDeepStrictEqual", (a, b, msg) => b === null ? null : `${expectMsg(a, msg)}.not.toStrictEqual(${b})`);
  src = rewriteAssert(src, "notDeepEqual",    (a, b, msg) => b === null ? null : `${expectMsg(a, msg)}.not.toEqual(${b})`);
  src = rewriteAssert(src, "ok",              (a, _, msg) => `${expectMsg(a, msg)}.toBeTruthy()`);
  src = rewriteAssert(src, "throws",          (a, b, msg) => {
    if (b === null) return `expect(${a}).toThrow()`;
    // Validator functions can't be passed to .toThrow() — leave for manual fix
    if (/^\s*\(/.test(b) || /^\s*(async\s+)?function/.test(b)) return null;
    return `expect(${a}).toThrow(${b})`;
  });
  src = rewriteAssert(src, "doesNotThrow",    (a) => `expect(${a}).not.toThrow()`);
  src = rewriteAssert(src, "match",           (a, b) => b === null ? null : `expect(${a}).toMatch(${b})`);
  src = rewriteAssert(src, "notMatch",        (a, b) => b === null ? null : `expect(${a}).not.toMatch(${b})`);
  // assert.rejects — leave complex validator-function forms for manual review, handle simple ones
  src = rewriteAssert(src, "rejects",         (a, b, msg) => {
    if (b === null) return `await expect(${a}).rejects.toThrow()`;
    // Validator functions can't be passed to .rejects.toThrow() — leave for manual fix
    if (/^\s*\(/.test(b) || /^\s*(async\s+)?function/.test(b)) return null;
    return `await expect(${a}).rejects.toThrow(${b})`;
  });
  src = rewriteAssert(src, "doesNotReject",   (a) => `await expect(${a}).resolves.not.toThrow()`);
  src = rewriteAssert(src, "fail",            (a) => `expect.fail(${a})`);
  src = rewriteAssert(src, "ifError",         (a) => `if (${a}) throw ${a}`);

  // Bare assert(x, msg) and assert(x)
  src = src.replace(/\bassert\(([^)]+)\)/g, (_, inner) => {
    const parts = inner.split(",");
    if (parts.length === 1) return `expect(${inner.trim()}).toBeTruthy()`;
    const a = parts[0].trim();
    const msg = parts.slice(1).join(",").trim();
    return `expect(${a}, ${msg}).toBeTruthy()`;
  });

  // ─── 3. mock.* → vi.* ────────────────────────────────────────────────────
  src = replaceAll(src, "mock.method(", (s, pos) => {
    const { arg: a1, nextPos: p1 } = extractArg(s, pos);
    if (s[p1] !== ",") return null;
    const { arg: a2, nextPos: p2 } = extractArg(s, p1 + 1);
    if (s[p2] !== ",") return { text: `vi.spyOn(${a1.trim()}, ${a2.trim()})`, endPos: p2 + 1 };
    // has implementation arg
    const { arg: a3, nextPos: p3 } = extractArg(s, p2 + 1);
    return { text: `vi.spyOn(${a1.trim()}, ${a2.trim()}).mockImplementation(${a3.trim()})`, endPos: p3 + 1 };
  });
  src = src.replace(/\bmock\.fn\(\)/g, "vi.fn()");
  src = src.replace(/\bmock\.fn\(([^)]+)\)/g, "vi.fn($1)");
  src = src.replace(/\bmock\.restoreAll\(\)/g, "vi.restoreAllMocks()");

  // ─── 4. { skip: SKIP } → test.skipIf(SKIP) ───────────────────────────────
  src = src.replace(
    /\btest\(('[^']*'|"[^"]*"|`[^`]*`),\s*\{\s*skip:\s*(\w+)\s*\},\s*/g,
    "test.skipIf($2)($1, "
  );

  if (src !== orig) {
    writeFileSync(file, src);
    console.log(`✓ converted: ${file}`);
    converted++;
  } else {
    console.log(`  unchanged: ${file}`);
  }
}

console.log(`\nConverted ${converted} / ${files.length} files.`);
