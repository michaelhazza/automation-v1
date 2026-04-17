#!/usr/bin/env node
// ---------------------------------------------------------------------------
// verify-integration-reference.mjs
//
// Static gate for docs/integration-reference.md. Validates:
//
//  1. Schema — every fenced `yaml integration` block has all required fields
//     with the right types.
//  2. Runtime consistency —
//       - every slug in the reference is unique
//       - every capability slug referenced in skills_enabled / read_capabilities
//         / write_capabilities / primitives_required appears in
//         capability_taxonomy (or its aliases)
//       - every skill slug in skills_enabled corresponds to a .md file under
//         server/skills/
//  3. Reverse consistency —
//       - every OAuth provider in server/config/oauthProviders.ts appears as
//         a reference block (or is explicitly excluded)
//       - every MCP preset in server/config/mcpPresets.ts appears as a
//         reference block (or is explicitly excluded)
//  4. Taxonomy naming conventions —
//       - read capabilities follow `<resource>_read` or `<resource>_list`
//       - write capabilities follow `<verb>_<resource>`
//       - primitives are lowercase compound nouns
//
// Exits 0 on pass, 1 on blocking failure, 2 on warning.
// ---------------------------------------------------------------------------

import { readFile, readdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, '..');

const REFERENCE_PATH = resolve(ROOT, 'docs/integration-reference.md');
const SKILLS_DIR = resolve(ROOT, 'server/skills');
const OAUTH_PROVIDERS_PATH = resolve(ROOT, 'server/config/oauthProviders.ts');
const MCP_PRESETS_PATH = resolve(ROOT, 'server/config/mcpPresets.ts');

// Integrations known to be intentionally absent from the reference (internal-only,
// deprecated, or under a different tracking doc). Keep this list short.
const OAUTH_PROVIDERS_EXCLUDED = new Set([
  'teamwork', // tracked separately; scopes still TBD
]);

const MCP_PRESETS_EXCLUDED = new Set();

const REQUIRED_INTEGRATION_FIELDS = [
  'slug', 'name', 'provider_type', 'status', 'visibility',
  'read_capabilities', 'write_capabilities', 'skills_enabled', 'primitives_required',
  'auth_method', 'required_scopes', 'setup_steps_summary',
  'typical_use_cases', 'broadly_useful_patterns', 'known_gaps', 'client_specific_patterns',
  'implemented_since', 'last_verified', 'owner',
];

const PROVIDER_TYPES = new Set(['oauth', 'mcp', 'webhook', 'native', 'hybrid']);
const STATUSES = new Set(['fully_supported', 'partial', 'stub', 'planned']);
const VISIBILITIES = new Set(['public', 'internal', 'beta']);
const AUTH_METHODS = new Set(['oauth2', 'api_key', 'none', 'mcp_token']);

const errors = [];
const warnings = [];

function err(msg) { errors.push(msg); }
function warn(msg) { warnings.push(msg); }

// ---------------------------------------------------------------------------
// Block extraction — same shape as integrationReferenceService.ts
// ---------------------------------------------------------------------------

function extractFencedBlocks(markdown) {
  const lines = markdown.split('\n');
  const blocks = [];
  let inBlock = false;
  let tag = '';
  let body = [];
  let startLine = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!inBlock) {
      const m = line.match(/^```yaml\s+(\S+)\s*$/);
      if (m) {
        inBlock = true;
        tag = m[1];
        body = [];
        startLine = i + 1;
      }
    } else {
      if (line.trim() === '```') {
        blocks.push({ tag, body: body.join('\n'), startLine });
        inBlock = false;
      } else {
        body.push(line);
      }
    }
  }
  return blocks;
}

// ---------------------------------------------------------------------------
// OAuth / MCP source-of-truth extraction
// ---------------------------------------------------------------------------

async function extractOAuthProviderKeys() {
  const src = await readFile(OAUTH_PROVIDERS_PATH, 'utf-8');
  const registryMatch = src.match(/OAUTH_PROVIDERS:\s*Record<[^>]+>\s*=\s*\{([\s\S]*?)\n\};/);
  if (!registryMatch) return [];
  const body = registryMatch[1];
  const keys = [];
  // Top-level keys of OAUTH_PROVIDERS are indented with exactly 2 spaces;
  // nested keys like `extra:` and `scopes:` use 4+ spaces. Anchoring to 2
  // spaces excludes nested keys.
  for (const line of body.split('\n')) {
    const m = line.match(/^ {2}([a-z0-9_-]+):\s*\{/);
    if (m) keys.push(m[1]);
  }
  return keys;
}

async function extractMcpPresetSlugs() {
  const src = await readFile(MCP_PRESETS_PATH, 'utf-8');
  const slugs = [];
  const regex = /slug:\s*['"]([a-z0-9_-]+)['"]/g;
  let m;
  while ((m = regex.exec(src)) !== null) {
    slugs.push(m[1]);
  }
  return slugs;
}

// ---------------------------------------------------------------------------
// Naming convention checks
// ---------------------------------------------------------------------------

function checkReadCapabilityNaming(slug) {
  if (!/^[a-z0-9_]+_(read|list)$/.test(slug)) {
    warn(`Read capability '${slug}' does not follow <resource>_read or <resource>_list naming convention`);
  }
}

function checkWriteCapabilityNaming(slug) {
  // <verb>_<resource> — at least one underscore, no trailing _read/_list
  if (!/^[a-z][a-z0-9_]+$/.test(slug) || /_read$|_list$/.test(slug)) {
    warn(`Write capability '${slug}' does not follow <verb>_<resource> naming convention`);
  }
}

function checkPrimitiveNaming(slug) {
  if (!/^[a-z][a-z0-9_]+$/.test(slug)) {
    warn(`Primitive '${slug}' is not lowercase compound noun`);
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  let markdown;
  try {
    markdown = await readFile(REFERENCE_PATH, 'utf-8');
  } catch (e) {
    err(`Cannot read ${REFERENCE_PATH}: ${e.message}`);
    report();
    return;
  }

  const blocks = extractFencedBlocks(markdown);

  // --- meta ---
  const metaBlock = blocks.find((b) => b.tag === 'integration_reference_meta');
  if (!metaBlock) {
    err('Missing integration_reference_meta block');
  } else {
    try {
      const meta = parseYaml(metaBlock.body);
      if (!meta || typeof meta !== 'object') {
        err('integration_reference_meta is not an object');
      } else if (meta.schema_version !== '1.0.0') {
        err(`Unsupported schema_version '${meta.schema_version}' (expected 1.0.0)`);
      }
    } catch (e) {
      err(`Failed to parse integration_reference_meta: ${e.message}`);
    }
  }

  // --- taxonomy ---
  const taxonomyBlock = blocks.find((b) => b.tag === 'capability_taxonomy');
  let taxonomy = { read_capabilities: [], write_capabilities: [], skills: [], primitives: [] };
  if (!taxonomyBlock) {
    err('Missing capability_taxonomy block');
  } else {
    try {
      const parsed = parseYaml(taxonomyBlock.body);
      for (const section of ['read_capabilities', 'write_capabilities', 'skills', 'primitives']) {
        const entries = Array.isArray(parsed[section]) ? parsed[section] : [];
        taxonomy[section] = entries.map((e) => ({
          slug: String(e.slug ?? ''),
          aliases: Array.isArray(e.aliases) ? e.aliases.map(String) : [],
        }));
      }
      // Naming conventions
      for (const c of taxonomy.read_capabilities) checkReadCapabilityNaming(c.slug);
      for (const c of taxonomy.write_capabilities) checkWriteCapabilityNaming(c.slug);
      for (const c of taxonomy.primitives) checkPrimitiveNaming(c.slug);

      // Within-section duplicate check. Cross-section duplicates are permitted
      // (e.g. 'send_email' is both a write_capability and a concrete skill slug)
      // because the normaliser resolves with (kind, slug) as the composite key.
      for (const section of ['read_capabilities', 'write_capabilities', 'skills', 'primitives']) {
        const slugCount = new Map();
        for (const c of taxonomy[section]) {
          slugCount.set(c.slug, (slugCount.get(c.slug) ?? 0) + 1);
        }
        for (const [slug, count] of slugCount) {
          if (count > 1) {
            err(`Capability slug '${slug}' appears more than once in taxonomy section '${section}'`);
          }
        }
      }
    } catch (e) {
      err(`Failed to parse capability_taxonomy: ${e.message}`);
    }
  }

  const taxonomyLookup = (section) => {
    const set = new Set();
    for (const entry of taxonomy[section]) set.add(entry.slug);
    return set;
  };

  const readSlugs = taxonomyLookup('read_capabilities');
  const writeSlugs = taxonomyLookup('write_capabilities');
  const skillSlugs = taxonomyLookup('skills');
  const primitiveSlugs = taxonomyLookup('primitives');

  // --- integrations ---
  const integrationBlocks = blocks.filter((b) => b.tag === 'integration');
  const seenSlugs = new Set();
  const referenceIntegrations = [];

  for (const block of integrationBlocks) {
    let parsed;
    try {
      parsed = parseYaml(block.body);
    } catch (e) {
      err(`Block at line ${block.startLine}: YAML parse failed: ${e.message}`);
      continue;
    }
    if (!parsed || typeof parsed !== 'object') {
      err(`Block at line ${block.startLine}: not an object`);
      continue;
    }

    for (const field of REQUIRED_INTEGRATION_FIELDS) {
      if (!(field in parsed)) {
        err(`Block at line ${block.startLine}: missing required field '${field}'`);
      }
    }

    const slug = String(parsed.slug ?? '');
    if (!slug) continue;
    if (seenSlugs.has(slug)) {
      err(`Duplicate integration slug '${slug}' at line ${block.startLine}`);
      continue;
    }
    seenSlugs.add(slug);
    referenceIntegrations.push({ slug, parsed });

    if (!PROVIDER_TYPES.has(parsed.provider_type)) {
      err(`Integration '${slug}': invalid provider_type '${parsed.provider_type}'`);
    }
    if (!STATUSES.has(parsed.status)) {
      err(`Integration '${slug}': invalid status '${parsed.status}'`);
    }
    if (!VISIBILITIES.has(parsed.visibility)) {
      err(`Integration '${slug}': invalid visibility '${parsed.visibility}'`);
    }
    if (!AUTH_METHODS.has(parsed.auth_method)) {
      err(`Integration '${slug}': invalid auth_method '${parsed.auth_method}'`);
    }

    // Every capability slug referenced must appear in the taxonomy
    for (const s of parsed.read_capabilities ?? []) {
      if (!readSlugs.has(s)) err(`Integration '${slug}' references read_capability '${s}' which is not in the taxonomy`);
    }
    for (const s of parsed.write_capabilities ?? []) {
      if (!writeSlugs.has(s)) err(`Integration '${slug}' references write_capability '${s}' which is not in the taxonomy`);
    }
    for (const s of parsed.primitives_required ?? []) {
      if (!primitiveSlugs.has(s)) err(`Integration '${slug}' references primitive '${s}' which is not in the taxonomy`);
    }
    for (const s of parsed.skills_enabled ?? []) {
      if (!skillSlugs.has(s)) err(`Integration '${slug}' references skill '${s}' which is not in the taxonomy`);
    }
  }

  // --- skill slug existence in server/skills/ ---
  let skillFilesList = [];
  try {
    skillFilesList = (await readdir(SKILLS_DIR))
      .filter((f) => f.endsWith('.md'))
      .map((f) => f.replace(/\.md$/, ''));
  } catch (e) {
    warn(`Cannot read skills directory ${SKILLS_DIR}: ${e.message}`);
  }
  const skillFilesSet = new Set(skillFilesList);

  for (const entry of taxonomy.skills) {
    if (!skillFilesSet.has(entry.slug)) {
      warn(`Taxonomy declares skill '${entry.slug}' but no matching file ${entry.slug}.md exists in server/skills/`);
    }
  }

  // --- reverse consistency: OAuth providers ---
  try {
    const oauthKeys = await extractOAuthProviderKeys();
    for (const key of oauthKeys) {
      if (OAUTH_PROVIDERS_EXCLUDED.has(key)) continue;
      if (!seenSlugs.has(key)) {
        err(`OAuth provider '${key}' is wired in oauthProviders.ts but has no integration block in integration-reference.md`);
      }
    }
  } catch (e) {
    warn(`Could not check OAuth provider consistency: ${e.message}`);
  }

  // --- reverse consistency: MCP presets ---
  try {
    const mcpSlugs = await extractMcpPresetSlugs();
    for (const slug of mcpSlugs) {
      if (MCP_PRESETS_EXCLUDED.has(slug)) continue;
      // Accept either exact slug match or suffixed variants like 'playwright-mcp' for 'playwright'
      const match = seenSlugs.has(slug) || seenSlugs.has(`${slug}-mcp`);
      if (!match) {
        warn(`MCP preset '${slug}' is wired in mcpPresets.ts but has no integration block in integration-reference.md`);
      }
    }
  } catch (e) {
    warn(`Could not check MCP preset consistency: ${e.message}`);
  }

  report();
}

function report() {
  if (errors.length === 0 && warnings.length === 0) {
    console.log(`[OK] Integration reference is consistent.`);
    process.exit(0);
  }
  if (warnings.length > 0) {
    console.log(`\n[WARNINGS]`);
    for (const w of warnings) console.log(`  - ${w}`);
  }
  if (errors.length > 0) {
    console.log(`\n[ERRORS]`);
    for (const e of errors) console.log(`  - ${e}`);
    console.log(`\nFound ${errors.length} blocking error(s), ${warnings.length} warning(s).`);
    process.exit(1);
  }
  console.log(`\nFound 0 blocking errors, ${warnings.length} warning(s).`);
  process.exit(2);
}

main().catch((e) => {
  console.error('verify-integration-reference.mjs crashed:', e);
  process.exit(1);
});
