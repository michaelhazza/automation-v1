/**
 * build-portable-framework.ts
 *
 * Reads the in-repo source of truth at `setup/portable/` and produces a
 * versioned zip at `dist/portable-claude-framework-v<VERSION>.zip`.
 *
 * Usage:
 *   npm run build:portable-framework
 *   tsx scripts/build-portable-framework.ts
 *
 * Design notes:
 *   - Source of truth is `setup/portable/`. Anything outside that path is NOT
 *     part of the export. This is deliberate — repo-local code stays repo-local.
 *   - Version comes from `.claude/FRAMEWORK_VERSION` inside the bundle (NOT from
 *     the package.json). The bundle ships its own framework version.
 *   - Output is `dist/portable-claude-framework-v<VERSION>.zip`. Old versions
 *     are not deleted — keep history available for rollback.
 *   - Pre-flight checks: no remaining placeholders that should have been
 *     substituted at authoring time (e.g. project-specific names in agents);
 *     no leftover conflict markers; FRAMEWORK_VERSION matches CHANGELOG.
 */

import { promises as fs, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');

const SOURCE_DIR = path.join(ROOT, 'setup', 'portable');
const DIST_DIR = path.join(ROOT, 'dist');
const VERSION_FILE = path.join(SOURCE_DIR, '.claude', 'FRAMEWORK_VERSION');
const CHANGELOG_FILE = path.join(SOURCE_DIR, '.claude', 'CHANGELOG.md');

// Strings that must NOT appear in the bundle. Catches forgotten substitutions
// before they ship. The internal repo's project name is the most important
// one — if it leaks into the export, target repos will see it.
const FORBIDDEN_STRINGS = [
  'Automation OS',
  'AutomationOS',
  'automation-v1',
  'Synthetos',
];

interface PreflightResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
}

async function readVersion(): Promise<string> {
  const raw = await fs.readFile(VERSION_FILE, 'utf8');
  const v = raw.trim();
  if (!/^\d+\.\d+\.\d+$/.test(v)) {
    throw new Error(`FRAMEWORK_VERSION malformed: "${v}". Expected semver (e.g. "2.0.0").`);
  }
  return v;
}

async function preflight(version: string): Promise<PreflightResult> {
  const errors: string[] = [];
  const warnings: string[] = [];

  // 1. Source dir exists.
  if (!existsSync(SOURCE_DIR)) {
    errors.push(`Source directory missing: ${SOURCE_DIR}`);
    return { ok: false, errors, warnings };
  }

  // 2. ADAPT.md and README.md exist (the two mandatory entry points).
  for (const required of ['ADAPT.md', 'README.md']) {
    if (!existsSync(path.join(SOURCE_DIR, required))) {
      errors.push(`Required file missing: setup/portable/${required}`);
    }
  }

  // 3. CHANGELOG mentions the current version.
  const changelog = await fs.readFile(CHANGELOG_FILE, 'utf8');
  if (!changelog.includes(`## ${version}`)) {
    errors.push(`CHANGELOG.md does not contain a section for current version "${version}". Add one before building.`);
  }

  // 4. Forbidden-string scan. Walk every text file under SOURCE_DIR.
  const offenders: string[] = [];
  async function walk(dir: string): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        await walk(full);
      } else if (e.isFile() && /\.(md|json|js|ts|sh|txt)$/.test(e.name)) {
        const content = await fs.readFile(full, 'utf8');
        for (const needle of FORBIDDEN_STRINGS) {
          if (content.includes(needle)) {
            const rel = path.relative(SOURCE_DIR, full);
            offenders.push(`${rel}: contains forbidden string "${needle}"`);
          }
        }
        if (/<<<<<<<|=======|>>>>>>>/m.test(content)) {
          const rel = path.relative(SOURCE_DIR, full);
          offenders.push(`${rel}: contains git conflict marker`);
        }
      }
    }
  }
  await walk(SOURCE_DIR);
  errors.push(...offenders);

  // 4b. Legacy-format placeholder scan. Any remaining [PROJECT_NAME]-style
  // placeholders must have been migrated to {{PROJECT_NAME}} before building.
  // CHANGELOG.md and README.md are exempt: they intentionally document the old
  // format by name in explanatory prose and code spans.
  const LEGACY_PLACEHOLDER_NAMES = ['PROJECT_NAME', 'PROJECT_DESCRIPTION', 'STACK_DESCRIPTION', 'COMPANY_NAME'];
  const LEGACY_SCAN_EXEMPT = new Set(['CHANGELOG.md', 'README.md']);
  async function walkLegacy(dir: string): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        await walkLegacy(full);
      } else if (e.isFile() && /\.(md|json|js|ts|sh|txt)$/.test(e.name) && !LEGACY_SCAN_EXEMPT.has(e.name)) {
        const content = await fs.readFile(full, 'utf8');
        const rel = path.relative(SOURCE_DIR, full);
        for (const name of LEGACY_PLACEHOLDER_NAMES) {
          if (content.includes(`[${name}]`)) {
            errors.push(`leftover legacy-format placeholder in ${rel}: found "[${name}]" — migrate to "{{${name}}}"`);
          }
        }
      }
    }
  }
  await walkLegacy(SOURCE_DIR);

  // 5. Agent fleet count sanity. Bundle should have 19 agents.
  const agentsDir = path.join(SOURCE_DIR, '.claude', 'agents');
  if (existsSync(agentsDir)) {
    const agents = (await fs.readdir(agentsDir)).filter(f => f.endsWith('.md'));
    if (agents.length !== 20) {
      warnings.push(`Agent count is ${agents.length}; expected 20 (FULL profile). If intentional, ignore this warning.`);
    }
  } else {
    errors.push('.claude/agents/ directory missing in bundle source');
  }

  // 6. Hooks count. Bundle ships 4 portable hooks.
  const hooksDir = path.join(SOURCE_DIR, '.claude', 'hooks');
  if (existsSync(hooksDir)) {
    const hooks = (await fs.readdir(hooksDir)).filter(f => /\.(js|sh)$/.test(f));
    if (hooks.length !== 4) {
      warnings.push(`Hooks count is ${hooks.length}; expected 4 (long-doc-guard, correction-nudge, config-protection, code-graph-freshness-check).`);
    }
  } else {
    errors.push('.claude/hooks/ directory missing in bundle source');
  }

  return { ok: errors.length === 0, errors, warnings };
}

async function buildZip(version: string): Promise<string> {
  await fs.mkdir(DIST_DIR, { recursive: true });
  const zipName = `portable-claude-framework-v${version}.zip`;
  const zipPath = path.join(DIST_DIR, zipName);
  // Remove any stale artifact at the same version so we don't ship a partial.
  if (existsSync(zipPath)) await fs.unlink(zipPath);

  // Use the OS `zip` if available; otherwise fall back to PowerShell's Compress-Archive on Windows.
  const isWindows = process.platform === 'win32';
  if (isWindows) {
    // PowerShell route — works on every Windows machine without external tools.
    await runCommand('powershell.exe', [
      '-NoProfile',
      '-Command',
      `Compress-Archive -Path "${SOURCE_DIR}\\*" -DestinationPath "${zipPath}" -Force`,
    ]);
  } else {
    // POSIX — `zip` should be present. Preflight-check before invoking so we
    // give a clear error rather than a cryptic ENOENT when running in minimal
    // containers / CI images that ship without `zip`.
    await assertZipBinaryAvailable();
    await runCommand('zip', ['-rq', zipPath, '.'], { cwd: SOURCE_DIR });
  }
  return zipPath;
}

function assertZipBinaryAvailable(): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('zip', ['-v'], { stdio: ['ignore', 'ignore', 'ignore'] });
    child.on('error', () => reject(new Error(
      "`zip` binary not found on PATH. The portable-framework builder uses the system `zip` on POSIX. " +
      "Install it (apt: `apt-get install -y zip`, alpine: `apk add zip`, brew: `brew install zip`) and re-run.",
    )));
    child.on('exit', () => resolve());
  });
}

interface RunOptions {
  cwd?: string;
}

function runCommand(cmd: string, args: string[], options: RunOptions = {}): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      cwd: options.cwd,
    });
    let stderr = '';
    child.stderr.on('data', d => { stderr += d.toString(); });
    child.on('error', reject);
    child.on('exit', code => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} ${args.join(' ')} exited ${code}: ${stderr.slice(-500)}`));
    });
  });
}

async function main(): Promise<void> {
  process.stdout.write('[build-portable-framework] starting\n');

  const version = await readVersion();
  process.stdout.write(`[build-portable-framework] bundle version: ${version}\n`);

  const pf = await preflight(version);
  if (pf.warnings.length > 0) {
    process.stdout.write(`[build-portable-framework] warnings:\n`);
    for (const w of pf.warnings) process.stdout.write(`  - ${w}\n`);
  }
  if (!pf.ok) {
    process.stderr.write(`[build-portable-framework] PREFLIGHT FAILED:\n`);
    for (const e of pf.errors) process.stderr.write(`  - ${e}\n`);
    process.exit(1);
  }

  const zipPath = await buildZip(version);
  const stat = await fs.stat(zipPath);
  const sizeKb = Math.round(stat.size / 1024);
  process.stdout.write(`[build-portable-framework] built ${path.relative(ROOT, zipPath)} (${sizeKb} KB)\n`);
  process.stdout.write(`[build-portable-framework] done\n`);
}

main().catch(err => {
  process.stderr.write(`[build-portable-framework] fatal: ${err?.stack ?? err}\n`);
  process.exit(1);
});
