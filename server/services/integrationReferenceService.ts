import { readFile } from 'fs/promises';
import { resolve } from 'path';
import { parse as parseYaml } from 'yaml';

// ---------------------------------------------------------------------------
// Integration Reference parser
//
// Reads docs/integration-reference.md, extracts fenced YAML blocks tagged
// `yaml integration`, `yaml capability_taxonomy`, and
// `yaml integration_reference_meta`, parses each, validates schema, applies
// per-entry confidence levels, and returns a structured snapshot.
//
// Consumed by: list_platform_capabilities skill, check_capability_gap skill,
// scripts/verify-integration-reference.ts (static gate).
//
// See docs/orchestrator-capability-routing-spec.md §3 and §4.2.
// ---------------------------------------------------------------------------

const DEFAULT_REFERENCE_PATH = resolve(process.cwd(), 'docs/integration-reference.md');
const CACHE_TTL_MS = 60_000;
const STALE_VERIFICATION_DAYS = 30;
const SUPPORTED_SCHEMA_VERSION = '1.0.0';

export type ProviderType = 'oauth' | 'mcp' | 'webhook' | 'native' | 'hybrid';
export type IntegrationStatus = 'fully_supported' | 'partial' | 'stub' | 'planned';
export type Visibility = 'public' | 'internal' | 'beta';
export type AuthMethod = 'oauth2' | 'api_key' | 'none' | 'mcp_token';
export type Confidence = 'high' | 'stale' | 'unknown';
export type ReferenceState = 'healthy' | 'degraded' | 'unavailable';

export interface TaxonomyEntry {
  slug: string;
  aliases: string[];
  description: string;
}

export interface CapabilityTaxonomy {
  read_capabilities: TaxonomyEntry[];
  write_capabilities: TaxonomyEntry[];
  skills: TaxonomyEntry[];
  primitives: TaxonomyEntry[];
}

export interface IntegrationEntry {
  slug: string;
  name: string;
  provider_type: ProviderType;
  status: IntegrationStatus;
  visibility: Visibility;
  read_capabilities: string[];
  write_capabilities: string[];
  skills_enabled: string[];
  primitives_required: string[];
  auth_method: AuthMethod;
  required_scopes: string[];
  setup_steps_summary: string;
  setup_doc_link: string | null;
  typical_use_cases: string[];
  broadly_useful_patterns: string[];
  known_gaps: string[];
  client_specific_patterns: string[];
  implemented_since: string;
  last_verified: string;
  owner: string;

  // Runtime-computed
  confidence: Confidence;
  confidence_reason: string;
}

export interface SchemaMeta {
  schema_version: string;
  last_updated: string;
}

export interface IntegrationReferenceSnapshot {
  integrations: IntegrationEntry[];
  capability_taxonomy: CapabilityTaxonomy;
  schema_meta: SchemaMeta;
  reference_state: ReferenceState;
  parse_errors: string[];
  source_path: string;
}

interface CacheEntry {
  snapshot: IntegrationReferenceSnapshot;
  loadedAt: number;
  sourcePath: string;
}

let cache: CacheEntry | null = null;

const EMPTY_TAXONOMY: CapabilityTaxonomy = {
  read_capabilities: [],
  write_capabilities: [],
  skills: [],
  primitives: [],
};

const UNAVAILABLE_SNAPSHOT = (sourcePath: string, error: string): IntegrationReferenceSnapshot => ({
  integrations: [],
  capability_taxonomy: EMPTY_TAXONOMY,
  schema_meta: { schema_version: SUPPORTED_SCHEMA_VERSION, last_updated: '' },
  reference_state: 'unavailable',
  parse_errors: [error],
  source_path: sourcePath,
});

// ---------------------------------------------------------------------------
// Block extraction
// ---------------------------------------------------------------------------

interface FencedBlock {
  tag: string;
  body: string;
  startLine: number;
}

/**
 * Extract fenced YAML blocks tagged with specific identifiers. A block starts
 * with ```tag and ends with ```.
 */
export function extractFencedBlocks(markdown: string): FencedBlock[] {
  const lines = markdown.split('\n');
  const blocks: FencedBlock[] = [];
  let inBlock = false;
  let currentTag = '';
  let currentBody: string[] = [];
  let blockStart = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!inBlock) {
      const openMatch = line.match(/^```yaml\s+(\S+)\s*$/);
      if (openMatch) {
        inBlock = true;
        currentTag = openMatch[1];
        currentBody = [];
        blockStart = i + 1;
      }
    } else {
      if (line.trim() === '```') {
        blocks.push({ tag: currentTag, body: currentBody.join('\n'), startLine: blockStart });
        inBlock = false;
        currentTag = '';
        currentBody = [];
      } else {
        currentBody.push(line);
      }
    }
  }

  return blocks;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const PROVIDER_TYPES: ProviderType[] = ['oauth', 'mcp', 'webhook', 'native', 'hybrid'];
const STATUSES: IntegrationStatus[] = ['fully_supported', 'partial', 'stub', 'planned'];
const VISIBILITIES: Visibility[] = ['public', 'internal', 'beta'];
const AUTH_METHODS: AuthMethod[] = ['oauth2', 'api_key', 'none', 'mcp_token'];

const REQUIRED_INTEGRATION_FIELDS = [
  'slug', 'name', 'provider_type', 'status', 'visibility',
  'read_capabilities', 'write_capabilities', 'skills_enabled', 'primitives_required',
  'auth_method', 'required_scopes', 'setup_steps_summary',
  'typical_use_cases', 'broadly_useful_patterns', 'known_gaps', 'client_specific_patterns',
  'implemented_since', 'last_verified', 'owner',
] as const;

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === 'string');
}

function validateIntegrationBlock(raw: unknown, lineHint: number): { ok: true; entry: IntegrationEntry } | { ok: false; error: string } {
  if (!raw || typeof raw !== 'object') {
    return { ok: false, error: `Block at line ${lineHint}: not an object` };
  }
  const obj = raw as Record<string, unknown>;

  for (const field of REQUIRED_INTEGRATION_FIELDS) {
    if (!(field in obj)) {
      return { ok: false, error: `Block at line ${lineHint}: missing required field '${field}'` };
    }
  }

  const slug = typeof obj.slug === 'string' ? obj.slug : '';
  if (!slug) return { ok: false, error: `Block at line ${lineHint}: slug must be a non-empty string` };

  const providerType = String(obj.provider_type);
  if (!PROVIDER_TYPES.includes(providerType as ProviderType)) {
    return { ok: false, error: `Block '${slug}': provider_type must be one of ${PROVIDER_TYPES.join(', ')}` };
  }

  const status = String(obj.status);
  if (!STATUSES.includes(status as IntegrationStatus)) {
    return { ok: false, error: `Block '${slug}': status must be one of ${STATUSES.join(', ')}` };
  }

  const visibility = String(obj.visibility);
  if (!VISIBILITIES.includes(visibility as Visibility)) {
    return { ok: false, error: `Block '${slug}': visibility must be one of ${VISIBILITIES.join(', ')}` };
  }

  const authMethod = String(obj.auth_method);
  if (!AUTH_METHODS.includes(authMethod as AuthMethod)) {
    return { ok: false, error: `Block '${slug}': auth_method must be one of ${AUTH_METHODS.join(', ')}` };
  }

  const entry: IntegrationEntry = {
    slug,
    name: String(obj.name),
    provider_type: providerType as ProviderType,
    status: status as IntegrationStatus,
    visibility: visibility as Visibility,
    read_capabilities: asStringArray(obj.read_capabilities),
    write_capabilities: asStringArray(obj.write_capabilities),
    skills_enabled: asStringArray(obj.skills_enabled),
    primitives_required: asStringArray(obj.primitives_required),
    auth_method: authMethod as AuthMethod,
    required_scopes: asStringArray(obj.required_scopes),
    setup_steps_summary: String(obj.setup_steps_summary ?? ''),
    setup_doc_link: obj.setup_doc_link == null ? null : String(obj.setup_doc_link),
    typical_use_cases: asStringArray(obj.typical_use_cases),
    broadly_useful_patterns: asStringArray(obj.broadly_useful_patterns),
    known_gaps: asStringArray(obj.known_gaps),
    client_specific_patterns: asStringArray(obj.client_specific_patterns),
    implemented_since: String(obj.implemented_since ?? ''),
    last_verified: String(obj.last_verified ?? ''),
    owner: String(obj.owner ?? ''),
    confidence: 'high',
    confidence_reason: '',
  };

  const { confidence, confidence_reason } = computeConfidence(entry);
  entry.confidence = confidence;
  entry.confidence_reason = confidence_reason;

  return { ok: true, entry };
}

function validateTaxonomyBlock(raw: unknown): { ok: true; taxonomy: CapabilityTaxonomy } | { ok: false; error: string } {
  if (!raw || typeof raw !== 'object') {
    return { ok: false, error: 'capability_taxonomy block: not an object' };
  }
  const obj = raw as Record<string, unknown>;
  const section = (name: string): TaxonomyEntry[] => {
    const list = obj[name];
    if (!Array.isArray(list)) return [];
    return list
      .filter((v): v is Record<string, unknown> => v != null && typeof v === 'object')
      .map((v): TaxonomyEntry => ({
        slug: String(v.slug ?? ''),
        aliases: asStringArray(v.aliases),
        description: String(v.description ?? ''),
      }))
      .filter((e) => e.slug);
  };

  return {
    ok: true,
    taxonomy: {
      read_capabilities: section('read_capabilities'),
      write_capabilities: section('write_capabilities'),
      skills: section('skills'),
      primitives: section('primitives'),
    },
  };
}

// ---------------------------------------------------------------------------
// Confidence
// ---------------------------------------------------------------------------

export function computeConfidence(entry: Pick<IntegrationEntry, 'status' | 'last_verified'>): { confidence: Confidence; confidence_reason: string } {
  if (entry.status === 'planned' || entry.status === 'stub') {
    return { confidence: 'stale', confidence_reason: `Status is ${entry.status}` };
  }

  const verifiedAt = Date.parse(entry.last_verified);
  if (Number.isNaN(verifiedAt)) {
    return { confidence: 'unknown', confidence_reason: `last_verified is not a valid ISO date` };
  }

  const ageMs = Date.now() - verifiedAt;
  const ageDays = ageMs / (24 * 60 * 60 * 1000);
  if (ageDays > STALE_VERIFICATION_DAYS) {
    return { confidence: 'stale', confidence_reason: `last_verified is ${Math.floor(ageDays)} days old (threshold ${STALE_VERIFICATION_DAYS})` };
  }

  if (entry.status === 'fully_supported') {
    return { confidence: 'high', confidence_reason: 'Fully supported and recently verified' };
  }
  if (entry.status === 'partial') {
    return { confidence: 'high', confidence_reason: 'Partial but recently verified' };
  }

  return { confidence: 'unknown', confidence_reason: 'Unrecognised status' };
}

// ---------------------------------------------------------------------------
// Parsing entry point
// ---------------------------------------------------------------------------

export interface ParseOptions {
  referencePath?: string;
  bypassCache?: boolean;
}

export async function loadIntegrationReference(options: ParseOptions = {}): Promise<IntegrationReferenceSnapshot> {
  const sourcePath = options.referencePath ?? DEFAULT_REFERENCE_PATH;

  if (!options.bypassCache && cache && cache.sourcePath === sourcePath && Date.now() - cache.loadedAt < CACHE_TTL_MS) {
    return cache.snapshot;
  }

  let markdown: string;
  try {
    markdown = await readFile(sourcePath, 'utf-8');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return UNAVAILABLE_SNAPSHOT(sourcePath, `Failed to read ${sourcePath}: ${message}`);
  }

  const snapshot = parseMarkdownPure(markdown, sourcePath);

  cache = {
    snapshot,
    loadedAt: Date.now(),
    sourcePath,
  };
  return snapshot;
}

/**
 * Pure parser — exposed for pure-function tests. Does no IO.
 */
export function parseMarkdownPure(markdown: string, sourcePath: string): IntegrationReferenceSnapshot {
  const parseErrors: string[] = [];
  const blocks = extractFencedBlocks(markdown);

  // --- Meta block ---
  const metaBlock = blocks.find((b) => b.tag === 'integration_reference_meta');
  let schemaMeta: SchemaMeta = { schema_version: SUPPORTED_SCHEMA_VERSION, last_updated: '' };
  if (metaBlock) {
    try {
      const parsed = parseYaml(metaBlock.body) as Record<string, unknown>;
      schemaMeta = {
        schema_version: String(parsed.schema_version ?? ''),
        last_updated: String(parsed.last_updated ?? ''),
      };
      if (schemaMeta.schema_version !== SUPPORTED_SCHEMA_VERSION) {
        parseErrors.push(`Unsupported schema_version '${schemaMeta.schema_version}' (expected '${SUPPORTED_SCHEMA_VERSION}')`);
      }
    } catch (err) {
      parseErrors.push(`Failed to parse integration_reference_meta block: ${err instanceof Error ? err.message : String(err)}`);
    }
  } else {
    parseErrors.push('Missing integration_reference_meta block');
  }

  // --- Taxonomy block ---
  const taxonomyBlock = blocks.find((b) => b.tag === 'capability_taxonomy');
  let taxonomy: CapabilityTaxonomy = EMPTY_TAXONOMY;
  if (taxonomyBlock) {
    try {
      const parsed = parseYaml(taxonomyBlock.body);
      const result = validateTaxonomyBlock(parsed);
      if (result.ok) {
        taxonomy = result.taxonomy;
      } else {
        parseErrors.push(result.error);
      }
    } catch (err) {
      parseErrors.push(`Failed to parse capability_taxonomy block: ${err instanceof Error ? err.message : String(err)}`);
    }
  } else {
    parseErrors.push('Missing capability_taxonomy block');
  }

  // --- Integration blocks ---
  const integrations: IntegrationEntry[] = [];
  const seenSlugs = new Set<string>();
  for (const block of blocks.filter((b) => b.tag === 'integration')) {
    try {
      const parsed = parseYaml(block.body);
      const result = validateIntegrationBlock(parsed, block.startLine);
      if (result.ok) {
        if (seenSlugs.has(result.entry.slug)) {
          parseErrors.push(`Duplicate integration slug '${result.entry.slug}' at line ${block.startLine}`);
        } else {
          seenSlugs.add(result.entry.slug);
          integrations.push(result.entry);
        }
      } else {
        parseErrors.push(result.error);
      }
    } catch (err) {
      parseErrors.push(`Failed to parse integration block at line ${block.startLine}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // --- Reference state rollup ---
  let referenceState: ReferenceState;
  if (integrations.length === 0 && parseErrors.length > 0) {
    referenceState = 'unavailable';
  } else if (parseErrors.length > 0 || integrations.some((i) => i.confidence !== 'high')) {
    referenceState = 'degraded';
  } else {
    referenceState = 'healthy';
  }

  return {
    integrations,
    capability_taxonomy: taxonomy,
    schema_meta: schemaMeta,
    reference_state: referenceState,
    parse_errors: parseErrors,
    source_path: sourcePath,
  };
}

// ---------------------------------------------------------------------------
// Slug normalisation + stable stringify
// ---------------------------------------------------------------------------

export type CapabilityKind = 'integration' | 'read_capability' | 'write_capability' | 'skill' | 'primitive';

export interface RawCapability {
  kind: CapabilityKind;
  slug: string;
}

export type NormalisationStatus = 'canonical' | 'aliased' | 'unresolved';

export interface NormalisedCapability extends RawCapability {
  canonical_slug: string;
  original_slug: string;
  normalisation_status: NormalisationStatus;
}

/**
 * Resolve a slug to its canonical form using the capability taxonomy. Returns
 * the canonical slug if the input is already canonical or matches an alias;
 * otherwise returns the input unchanged with status 'unresolved'.
 */
export function normalizeCapabilitySlug(
  kind: CapabilityKind,
  slug: string,
  taxonomy: CapabilityTaxonomy,
  integrationSlugs: Set<string>,
): NormalisedCapability {
  const lowered = slug.toLowerCase().trim();

  // Integration kind is resolved against the integration slug list, not the taxonomy.
  if (kind === 'integration') {
    if (integrationSlugs.has(lowered)) {
      return { kind, slug: lowered, canonical_slug: lowered, original_slug: slug, normalisation_status: 'canonical' };
    }
    return { kind, slug, canonical_slug: slug, original_slug: slug, normalisation_status: 'unresolved' };
  }

  const section: TaxonomyEntry[] = (() => {
    switch (kind) {
      case 'read_capability': return taxonomy.read_capabilities;
      case 'write_capability': return taxonomy.write_capabilities;
      case 'skill': return taxonomy.skills;
      case 'primitive': return taxonomy.primitives;
    }
  })();

  // Canonical match
  const canonical = section.find((entry) => entry.slug === lowered);
  if (canonical) {
    return { kind, slug: lowered, canonical_slug: canonical.slug, original_slug: slug, normalisation_status: 'canonical' };
  }

  // Alias match
  const aliased = section.find((entry) => entry.aliases.includes(lowered));
  if (aliased) {
    return { kind, slug: aliased.slug, canonical_slug: aliased.slug, original_slug: slug, normalisation_status: 'aliased' };
  }

  return { kind, slug, canonical_slug: slug, original_slug: slug, normalisation_status: 'unresolved' };
}

export function normalizeCapabilitySlugs(
  inputs: RawCapability[],
  snapshot: IntegrationReferenceSnapshot,
): NormalisedCapability[] {
  const integrationSlugs = new Set(snapshot.integrations.map((i) => i.slug));
  return inputs.map((input) => normalizeCapabilitySlug(input.kind, input.slug, snapshot.capability_taxonomy, integrationSlugs));
}

/**
 * Deterministic JSON stringify — deep-sorts object keys before serialising so
 * equivalent inputs always produce the same output string. Used for cache
 * keys and dedupe hashes (see spec §5.4, §6.4.3).
 *
 * Do NOT replace with JSON.stringify — object key ordering is unspecified in
 * some runtimes and will break cache equivalence.
 */
export function stableStringify(value: unknown): string {
  if (value === null || value === undefined) return JSON.stringify(value);
  if (typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return '[' + value.map((v) => stableStringify(v)).join(',') + ']';
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  const parts = keys.map((k) => JSON.stringify(k) + ':' + stableStringify(obj[k]));
  return '{' + parts.join(',') + '}';
}

// ---------------------------------------------------------------------------
// Test hooks
// ---------------------------------------------------------------------------

/** Clear the in-process cache. Test-only; not exposed in production paths. */
export function __resetCacheForTests(): void {
  cache = null;
}
