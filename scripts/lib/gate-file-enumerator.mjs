// scripts/lib/gate-file-enumerator.mjs
import { globSync } from 'glob';

/**
 * Enumerate files for a gate using Node-native glob (OS-portable).
 * Replaces the bash `find → temp-file → fs.existsSync` pipeline that
 * breaks on Windows git-bash (POSIX paths rejected by Node on Windows).
 *
 * @param {{ root: string, includes: string[], excludes?: string[] }} opts
 *   root     - absolute repo root; process.env.GATE_ROOT overrides if set
 *   includes - glob patterns relative to root
 *   excludes - glob patterns to filter out (default: test files + node_modules)
 * @returns {string[]} absolute paths, sorted, deduped, Node-native form
 */
export function enumerateGateFiles({ root, includes, excludes = [] }) {
  const resolvedRoot = process.env.GATE_ROOT ?? root;
  const defaultExcludes = ['**/*.test.ts', '**/*.integration.test.ts', '**/node_modules/**'];
  const allExcludes = [...defaultExcludes, ...excludes];

  const files = new Set();
  for (const pattern of includes) {
    const matches = globSync(pattern, {
      cwd: resolvedRoot,
      absolute: true,
      ignore: allExcludes,
      nodir: true,
    });
    for (const f of matches) files.add(f);
  }

  return [...files].sort();
}
