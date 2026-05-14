/**
 * orphan-component-analyser.mjs
 *
 * Pure helper for verify-no-orphan-react-component gate (P15).
 *
 * Detects React component files in client/src/pages/ and client/src/components/
 * that have zero ingress — not routed from App.tsx and not transitively
 * imported by any routed file.
 *
 * Entry-point detection:
 *   Parses App.tsx with REGEX (not ts-morph) for:
 *     lazy(() => import('./pages/X'))
 *     lazy(() => import('./pages/X').then(...))
 *   Both relative paths and subdirectory paths are handled.
 *
 * Transitive reachability:
 *   Uses ts-morph to walk the import graph from each routed page,
 *   collecting all transitively reachable file paths.
 *
 * Allow-list:
 *   Files listed in client/.orphan-allowlist.json are excluded.
 *   Shape: { "files": [{ "path": "...", "reason": "..." }] }
 *   Paths in the allow-list are relative to the repository root.
 *
 * Public API:
 *   findOrphanComponents({ entryFile, componentRoot, allowListFile, repoRoot }) → Violation[]
 *
 * @typedef {{ file: string, message: string }} Violation
 */

import { Project } from 'ts-morph';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import path from 'node:path';

/**
 * Collect all .tsx and .ts files recursively from a directory.
 *
 * @param {string}   dir    absolute directory path
 * @param {string[]} result accumulator
 */
function collectFiles(dir, result) {
  if (!existsSync(dir)) return;
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '__tests__') continue;
      collectFiles(full, result);
    } else if (
      (entry.name.endsWith('.tsx') || entry.name.endsWith('.ts')) &&
      !entry.name.endsWith('.test.tsx') &&
      !entry.name.endsWith('.test.ts')
    ) {
      result.push(full);
    }
  }
}

/**
 * Extract the set of routed page paths from App.tsx by regex.
 *
 * Matches patterns like:
 *   lazy(() => import('./pages/Foo'))
 *   lazy(() => import('./pages/subdir/Foo'))
 *   lazy(() => import('./pages/subdir/Foo').then(...))
 *
 * Returns a Set of absolute file paths (with .tsx/.ts extension resolved).
 *
 * @param {string} appTsxContent  raw text of App.tsx
 * @param {string} appTsxDir      directory containing App.tsx (for path resolution)
 * @returns {Set<string>}
 */
function extractRoutedPaths(appTsxContent, appTsxDir) {
  const routed = new Set();
  // Match: lazy(() => import('./pages/...')) with optional .then(...)
  const importPattern = /lazy\s*\(\s*\(\)\s*=>\s*import\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  let match;
  while ((match = importPattern.exec(appTsxContent)) !== null) {
    const importPath = match[1];
    const base = path.resolve(appTsxDir, importPath);
    for (const ext of ['.tsx', '.ts']) {
      const candidate = base + ext;
      if (existsSync(candidate)) {
        routed.add(candidate);
        break;
      }
    }
    // Also try the exact path (in case it already has an extension).
    if (existsSync(base)) {
      routed.add(base);
    }
  }
  return routed;
}

/**
 * Collect all files transitively reachable (via imports) from the given
 * entry files using ts-morph.
 *
 * @param {import('ts-morph').Project} project
 * @param {Set<string>}                entryPaths  absolute paths to entry files
 * @returns {Set<string>}  absolute paths of all reachable files
 */
function collectTransitiveImports(project, entryPaths) {
  const visited = new Set();
  const queue = [...entryPaths];

  while (queue.length > 0) {
    const current = queue.shift();
    if (visited.has(current)) continue;
    visited.add(current);

    const sf = project.getSourceFile(current);
    if (!sf) continue;

    for (const decl of sf.getImportDeclarations()) {
      const spec = decl.getModuleSpecifier().getLiteralText();
      if (!spec.startsWith('.')) continue; // skip node_modules

      const resolved = path.resolve(path.dirname(current), spec);
      // Try common extensions.
      let found = false;
      for (const ext of ['.tsx', '.ts']) {
        const candidate = resolved + ext;
        if (!visited.has(candidate) && existsSync(candidate)) {
          queue.push(candidate);
          found = true;
          break;
        }
      }
      // Try index files.
      if (!found) {
        for (const ext of ['/index.tsx', '/index.ts']) {
          const candidate = resolved + ext;
          if (!visited.has(candidate) && existsSync(candidate)) {
            queue.push(candidate);
            found = true;
            break;
          }
        }
      }
      // Try exact resolved path.
      if (!found && !visited.has(resolved) && existsSync(resolved)) {
        queue.push(resolved);
      }
    }
  }

  return visited;
}

/**
 * Load the allow-list from the JSON file.
 *
 * @param {string} allowListFile  absolute path to .orphan-allowlist.json
 * @param {string} repoRoot       absolute path to the repository root
 * @returns {Set<string>}  absolute paths of allowed files
 */
function loadAllowList(allowListFile, repoRoot) {
  if (!existsSync(allowListFile)) return new Set();
  const raw = readFileSync(allowListFile, 'utf8');
  const parsed = JSON.parse(raw);
  const allowed = new Set();
  if (Array.isArray(parsed.files)) {
    for (const entry of parsed.files) {
      if (entry.path) {
        // Paths in allow-list are relative to repo root.
        const absPath = path.resolve(repoRoot, entry.path);
        allowed.add(absPath);
      }
    }
  }
  return allowed;
}

/**
 * Find orphan React component files that are not routed and not transitively
 * imported by any routed file.
 *
 * @param {object} options
 * @param {string} options.entryFile      absolute path to App.tsx (the routing entry point)
 * @param {string} options.componentRoot  absolute path to client/src/
 * @param {string} options.allowListFile  absolute path to .orphan-allowlist.json
 * @param {string} options.repoRoot       absolute path to the repository root
 * @returns {Violation[]}
 */
export function findOrphanComponents({ entryFile, componentRoot, allowListFile, repoRoot }) {
  const appTsxContent = readFileSync(entryFile, 'utf8');
  const appTsxDir = path.dirname(entryFile);

  const routedPaths = extractRoutedPaths(appTsxContent, appTsxDir);

  // Collect all component files to scan.
  /** @type {string[]} */
  const allComponentFiles = [];
  collectFiles(path.join(componentRoot, 'pages'), allComponentFiles);
  collectFiles(path.join(componentRoot, 'components'), allComponentFiles);

  // Build ts-morph project.
  const project = new Project({
    addFilesFromTsConfig: false,
    skipFileDependencyResolution: true,
    compilerOptions: {
      allowJs: false,
      skipLibCheck: true,
      jsx: 1, // JsxEmit.Preserve — enables JSX parsing without emitting
    },
  });

  // Add App.tsx and all component files.
  project.addSourceFileAtPath(entryFile);
  for (const f of allComponentFiles) {
    project.addSourceFileAtPath(f);
  }

  // Collect all transitively reachable files from the routed entry points.
  // Include App.tsx itself (it imports Layout, ErrorBoundary, etc.).
  const allEntries = new Set([entryFile, ...routedPaths]);
  const reachable = collectTransitiveImports(project, allEntries);

  // Load allow-list.
  const allowed = loadAllowList(allowListFile, repoRoot);

  // Find orphans: component files not in reachable set and not allow-listed.
  /** @type {Violation[]} */
  const violations = [];

  for (const f of allComponentFiles) {
    if (reachable.has(f)) continue;
    if (allowed.has(f)) continue;

    const relPath = path.relative(repoRoot, f).replace(/\\/g, '/');
    violations.push({
      file: relPath,
      message: 'React component file has no ingress (not routed and not imported by any routed file)',
    });
  }

  return violations;
}
