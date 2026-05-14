/**
 * with-org-tx-analyser.mjs
 *
 * Pure helper for the verify-with-org-tx-or-scoped-db gate.
 *
 * Analyses TypeScript source files using ts-morph to find db call sites
 * (db.select / db.insert / db.update / db.delete) outside server/db/ and
 * checks whether the enclosing function is called from within a
 * withOrgTx(...) or getOrgScopedDb(...) call site.
 *
 * HEURISTIC LIMITATION: This performs a single-level, same-file caller walk only.
 *
 *   - Indirect calls (via setImmediate, queue handlers, event emitters, deep
 *     call chains) are not traced.
 *   - Cross-file callers are NOT walked: if `foo()` is defined in fileA and
 *     wrapped by `withOrgTx(foo)` in fileB, fileA's db.X() call is flagged.
 *     This is by design — name-only cross-file walks created false-negatives
 *     when two files defined same-named functions (see PR #307 F1).
 *
 * Violations that are genuinely safe but trigger one of these limitations
 * should be suppressed with the per-line directive:
 *   // guard-ignore: with-org-tx-or-scoped-db ADR-<id> <rationale>
 *
 * Public API:
 *   analyseWithOrgTxScope(repoRoot, files) → Violation[]
 *
 * @typedef {{ file: string, line: number, message: string }} Violation
 */

import { Project, SyntaxKind } from 'ts-morph';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const ORG_SCOPE_HELPERS = new Set(['withOrgTx', 'getOrgScopedDb']);
const DB_METHODS = new Set(['select', 'insert', 'update', 'delete']);

/**
 * Return true if the line has a per-line suppression for this gate.
 *
 * Accepted formats:
 *   // guard-ignore: with-org-tx-or-scoped-db ADR-<id> <rationale>
 *   // guard-ignore: with-org-tx-or-scoped-db reason="..."
 *
 * @param {string} lineText
 * @returns {boolean}
 */
function isLineSuppressed(lineText) {
  return (
    /guard-ignore:\s*with-org-tx-or-scoped-db\s+ADR-\S+/.test(lineText) ||
    /guard-ignore:\s*with-org-tx-or-scoped-db\s+reason="[^"]+"/.test(lineText)
  );
}

/**
 * Return true if the line immediately preceding the call site contains a
 * next-line suppression.
 *
 * @param {string[]} lines  all source lines (0-indexed)
 * @param {number}   lineNo 1-indexed line number of the call site
 * @returns {boolean}
 */
function isPrevLineSuppressed(lines, lineNo) {
  if (lineNo < 2) return false;
  const prev = lines[lineNo - 2] ?? '';
  return /guard-ignore-next-line:\s*with-org-tx-or-scoped-db/.test(prev);
}

/**
 * Find the name of the innermost function/method declaration enclosing
 * the given node.
 *
 * Returns the function name string, or null if not inside any named
 * function (e.g. top-level or inside an anonymous arrow function with no
 * immediately obvious name).
 *
 * @param {import('ts-morph').Node} node
 * @returns {string | null}
 */
function findEnclosingFunctionName(node) {
  let current = node.getParent();
  while (current) {
    const kind = current.getKind();
    if (
      kind === SyntaxKind.FunctionDeclaration ||
      kind === SyntaxKind.MethodDeclaration ||
      kind === SyntaxKind.FunctionExpression ||
      kind === SyntaxKind.ArrowFunction
    ) {
      // Try to get a name from the node or its variable declaration parent.
      const nameProp = /** @type {any} */ (current);
      if (typeof nameProp.getName === 'function') {
        const name = nameProp.getName();
        if (name) return name;
      }
      // Variable declaration: const foo = () => { ... }
      const varDecl = current.getParent();
      if (varDecl && varDecl.getKind() === SyntaxKind.VariableDeclaration) {
        const varName = /** @type {any} */ (varDecl).getName?.();
        if (varName) return varName;
      }
    }
    current = current.getParent();
  }
  return null;
}

/**
 * Return true if any call site in the given source file passes `funcName`
 * as a callback to withOrgTx(...) or getOrgScopedDb(...).
 *
 * Single-level caller walk: we look for calls of the form
 *   withOrgTx(tx => funcName(tx, ...))
 *   withOrgTx(funcName)
 *   getOrgScopedDb(...)  (helper itself is the scoped accessor; any call
 *   to funcName that uses the returned db is considered scoped)
 *
 * We also check whether `funcName` is called inside a function body that
 * itself references withOrgTx or getOrgScopedDb in its argument list.
 *
 * @param {import('ts-morph').SourceFile} sf
 * @param {string} funcName
 * @returns {boolean}
 */
function isCalledViaOrgScope(sf, funcName) {
  const callExprs = sf.getDescendantsOfKind(SyntaxKind.CallExpression);
  for (const call of callExprs) {
    const callee = call.getExpression().getText().trim();
    if (!ORG_SCOPE_HELPERS.has(callee)) continue;

    // For each argument to withOrgTx/getOrgScopedDb, walk the AST for
    // identifier nodes matching funcName. AST traversal — rather than a
    // textual `includes()` substring check — guarantees that comments,
    // string literals, and unrelated longer identifiers (e.g. `loadAll`
    // when funcName is `load`) cannot trigger a false-positive.
    // See PR #307 chatgpt-pr-review Round 2 / T5 for the regression case.
    for (const arg of call.getArguments()) {
      // Direct reference: withOrgTx(funcName) — the arg itself IS the identifier.
      if (arg.getKind() === SyntaxKind.Identifier && arg.getText() === funcName) {
        return true;
      }
      // Any identifier node inside the arg's subtree (function bodies,
      // method-call receivers, etc.) — covers both `funcName(tx)` (call)
      // and `someService.funcName(tx)` (method call), since both forms
      // contain an Identifier node with text === funcName.
      const identifiers = arg.getDescendantsOfKind(SyntaxKind.Identifier);
      for (const id of identifiers) {
        if (id.getText() === funcName) return true;
      }
    }
  }

  return false;
}

/**
 * Analyse a set of TypeScript files for db call sites that are not scoped
 * via withOrgTx or getOrgScopedDb.
 *
 * @param {string}   repoRoot  absolute path to the repository root
 * @param {string[]} files     absolute paths to the .ts files to analyse
 *                             (caller should exclude files under server/db/)
 * @returns {Violation[]}
 */
export function analyseWithOrgTxScope(repoRoot, files) {
  if (files.length === 0) return [];

  const tsConfigPath = path.join(repoRoot, 'tsconfig.json');
  const project = new Project({
    tsConfigFilePath: existsSync(tsConfigPath) ? tsConfigPath : undefined,
    addFilesFromTsConfig: false,
    skipFileDependencyResolution: true,
    compilerOptions: {
      allowJs: false,
      skipLibCheck: true,
    },
  });

  for (const f of files) {
    if (existsSync(f)) project.addSourceFileAtPath(f);
  }

  /** @type {Violation[]} */
  const violations = [];

  for (const sf of project.getSourceFiles()) {
    const filePath = sf.getFilePath();
    const relPath = path.relative(repoRoot, filePath).replace(/\\/g, '/');
    const rawText = readFileSync(filePath, 'utf8');
    const lines = rawText.split('\n');

    const callExprs = sf.getDescendantsOfKind(SyntaxKind.CallExpression);

    for (const call of callExprs) {
      // Match db.<method>(...)
      const expr = call.getExpression();
      if (expr.getKind() !== SyntaxKind.PropertyAccessExpression) continue;

      const propAccess = /** @type {import('ts-morph').PropertyAccessExpression} */ (expr);
      const objectText = propAccess.getExpression().getText().trim();
      const methodName = propAccess.getName();

      // Only flag db.select / db.insert / db.update / db.delete.
      if (objectText !== 'db' || !DB_METHODS.has(methodName)) continue;

      const lineNo = call.getStartLineNumber();
      const lineText = lines[lineNo - 1] ?? '';

      // Per-line suppression check.
      if (isLineSuppressed(lineText)) continue;
      if (isPrevLineSuppressed(lines, lineNo)) continue;

      // Find the enclosing function name.
      const enclosingFn = findEnclosingFunctionName(call);
      if (!enclosingFn) {
        // Top-level db call — always flag (no function wrapper to check).
        violations.push({
          file: relPath,
          line: lineNo,
          message: `db.${methodName}() at top level without withOrgTx/getOrgScopedDb scope`,
        });
        continue;
      }

      // Same-file caller walk: check if enclosingFn is called via an org-scope
      // helper IN THE SAME FILE as the function declaration. Cross-file callers
      // are out of scope — name-only matches across files create false-negatives
      // when two unrelated files share a function name (one safe, one not).
      // For cross-file safe-callers, use the per-line suppression directive:
      //   // guard-ignore: with-org-tx-or-scoped-db ADR-... <rationale>
      // See chatgpt-pr-review Round 1 / PR #307 F1 for the regression case.
      const scopeFound = isCalledViaOrgScope(sf, enclosingFn);

      if (!scopeFound) {
        violations.push({
          file: relPath,
          line: lineNo,
          message: `db.${methodName}() in '${enclosingFn}' not reached via withOrgTx/getOrgScopedDb (single-level walk)`,
        });
      }
    }
  }

  return violations;
}
