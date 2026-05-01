/**
 * Conservative codemod for branches that forked off main before W1 lands.
 * Applies the Riley Observations Wave 1 rename rules:
 *   1. playbook_ → workflow_ in SQL string literals, TS imports, route-path
 *      strings, and permission-key enum references
 *   2. Playbook → Workflow in TypeScript type/interface/class symbols
 *   3. /api/playbooks → /api/workflows (route strings only)
 *   4. processes → automations (table identifier contexts)
 *   5. ProcessService → AutomationService
 *
 * Usage:
 *   npx tsx scripts/codemod-riley-rename.ts [--dry-run] [--path src/]
 *
 * --dry-run: prints what would change without writing
 * --path:    restrict to a subdirectory (default: server/ + client/)
 *
 * Excludes:
 *   migrations/*.sql, **\/*.fixture.json, docs/superpowers/, tasks/review-logs/
 *
 * Plan §4.5.
 */

import * as fs from 'fs';
import * as path from 'path';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const pathArg = args.find((a) => a.startsWith('--path='))?.replace('--path=', '');

const ROOT = path.resolve(process.cwd());
const SEARCH_DIRS = pathArg
  ? [path.join(ROOT, pathArg)]
  : [path.join(ROOT, 'server'), path.join(ROOT, 'client')];

const EXCLUDE_RE = [
  /migrations[\\/]/,
  /\.fixture\.json$/,
  /docs[\\/]superpowers[\\/]/,
  /tasks[\\/]review-logs[\\/]/,
];

const EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.json']);

type Rule = {
  description: string;
  pattern: RegExp;
  replacement: string;
};

const RULES: Rule[] = [
  // Import paths: lib/playbook → lib/workflow
  {
    description: 'import path: lib/playbook → lib/workflow',
    pattern: /lib\/playbook\//g,
    replacement: 'lib/workflow/',
  },
  // CamelCase type symbols: Playbook → Workflow (word-boundary, not inside a string)
  {
    description: 'PascalCase: PlaybookX → WorkflowX',
    pattern: /\bPlaybook(?=[A-Z]|\b)/g,
    replacement: 'Workflow',
  },
  // camelCase property/variable: playbookRuns → workflowRuns etc.
  {
    description: 'camelCase: playbookRuns → workflowRuns',
    pattern: /\bplaybookRuns\b/g,
    replacement: 'workflowRuns',
  },
  {
    description: 'camelCase: playbookSlug → workflowSlug',
    pattern: /\bplaybookSlug\b/g,
    replacement: 'workflowSlug',
  },
  {
    description: 'camelCase: playbookStepRuns → workflowStepRuns',
    pattern: /\bplaybookStepRuns\b/g,
    replacement: 'workflowStepRuns',
  },
  // Route path strings
  {
    description: 'route: /api/playbook-runs → /api/workflow-runs',
    pattern: /\/api\/playbook-runs/g,
    replacement: '/api/workflow-runs',
  },
  {
    description: 'route: /api/playbook-studio → /api/workflow-studio',
    pattern: /\/api\/playbook-studio/g,
    replacement: '/api/workflow-studio',
  },
  {
    description: 'route: /api/playbook-templates → /api/workflow-templates',
    pattern: /\/api\/playbook-templates/g,
    replacement: '/api/workflow-templates',
  },
  // Permission enum keys: PLAYBOOK_* → WORKFLOW_*
  {
    description: 'permission: PLAYBOOK_ → WORKFLOW_',
    pattern: /\bPLAYBOOK_/g,
    replacement: 'WORKFLOW_',
  },
  // ProcessService → AutomationService
  {
    description: 'class: ProcessService → AutomationService',
    pattern: /\bProcessService\b/g,
    replacement: 'AutomationService',
  },
];

function shouldExclude(filePath: string): boolean {
  const rel = path.relative(ROOT, filePath).replace(/\\/g, '/');
  return EXCLUDE_RE.some((re) => re.test(rel));
}

function* walkDir(dir: string): Generator<string> {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '.git') continue;
      yield* walkDir(full);
    } else if (entry.isFile() && EXTENSIONS.has(path.extname(entry.name))) {
      yield full;
    }
  }
}

function applyRules(content: string): { changed: boolean; result: string; appliedRules: string[] } {
  let result = content;
  const appliedRules: string[] = [];
  for (const rule of RULES) {
    const before = result;
    result = result.replace(rule.pattern, rule.replacement);
    if (result !== before) appliedRules.push(rule.description);
  }
  return { changed: result !== content, result, appliedRules };
}

let totalFiles = 0;
let changedFiles = 0;

for (const dir of SEARCH_DIRS) {
  for (const file of walkDir(dir)) {
    if (shouldExclude(file)) continue;
    const content = fs.readFileSync(file, 'utf8');
    const { changed, result, appliedRules } = applyRules(content);
    if (changed) {
      changedFiles++;
      const rel = path.relative(ROOT, file);
      console.log(`${dryRun ? '[dry-run] ' : ''}${rel}`);
      for (const rule of appliedRules) console.log(`  + ${rule}`);
      if (!dryRun) fs.writeFileSync(file, result, 'utf8');
    }
    totalFiles++;
  }
}

console.log(`\n${dryRun ? '[dry-run] ' : ''}Processed ${totalFiles} files, would change / changed: ${changedFiles}`);
if (dryRun) console.log('Run without --dry-run to apply changes.');
