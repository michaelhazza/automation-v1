/**
 * configUpdateHierarchyTemplatePure — pure helpers for the Configuration Agent's
 * hierarchy-template config write path (§11.A). No I/O.
 *
 * Responsibilities:
 *   - applyPathPatch: deep-merge a dot-path/value into a config JSONB.
 *   - classifyWritePath: sensitive vs non-sensitive via SENSITIVE_CONFIG_PATHS.
 *   - buildConfigHistorySnapshotShape: prep the snapshot + changeSource for
 *     config_history insertion (caller supplies version).
 *   - validationDigest: stable hash of the proposed config for drift detection
 *     between proposal-time and approval-time.
 */

import crypto from 'crypto';
import {
  operationalConfigSchema,
  isSensitiveConfigPath,
  type OperationalConfigValidated,
} from './operationalConfigSchema.js';

export type WriteClassification = 'non_sensitive' | 'sensitive';

export interface PatchInput {
  path: string;
  value: unknown;
}

/**
 * Apply a dot-path patch to a config object, returning a new merged config.
 * - Empty path throws (nothing to patch).
 * - Missing intermediate objects are created.
 * - Array values replace wholesale (no splice semantics).
 * - Non-object targets along the path throw (misuse).
 */
export function applyPathPatch(
  config: Record<string, unknown>,
  patch: PatchInput,
): Record<string, unknown> {
  if (!patch.path || patch.path.trim().length === 0) {
    throw new Error('path is required');
  }
  const parts = patch.path.split('.');
  const next = deepClone(config);
  let cursor: Record<string, unknown> = next;
  for (let i = 0; i < parts.length - 1; i += 1) {
    const key = parts[i];
    const existing = cursor[key];
    if (existing === undefined || existing === null) {
      cursor[key] = {};
    } else if (typeof existing !== 'object' || Array.isArray(existing)) {
      throw new Error(`cannot descend into non-object at ${parts.slice(0, i + 1).join('.')}`);
    }
    cursor = cursor[key] as Record<string, unknown>;
  }
  cursor[parts[parts.length - 1]] = patch.value;
  return next;
}

export function classifyWritePath(path: string): WriteClassification {
  return isSensitiveConfigPath(path) ? 'sensitive' : 'non_sensitive';
}

export interface ValidationResult {
  ok: boolean;
  errorCode?: 'SCHEMA_INVALID' | 'SUM_CONSTRAINT_VIOLATED';
  message?: string;
  config?: OperationalConfigValidated;
}

/**
 * Validate the proposed full config. Sum-constraint violations (weights !=
 * 1.0) land inside the schema's superRefine, so this returns a single
 * error shape regardless of which validation layer tripped.
 */
export function validateProposedConfig(proposed: unknown): ValidationResult {
  const result = operationalConfigSchema.safeParse(proposed);
  if (result.success) return { ok: true, config: result.data };
  const isSumIssue = result.error.issues.some((i) => i.message.includes('weights must sum'));
  return {
    ok: false,
    errorCode: isSumIssue ? 'SUM_CONSTRAINT_VIOLATED' : 'SCHEMA_INVALID',
    message: result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
  };
}

/**
 * Stable digest of a config payload — used to detect drift between proposal
 * time and approval time on the sensitive-path action flow.
 */
export function validationDigest(config: unknown): string {
  return crypto
    .createHash('sha256')
    .update(stringifyStable(config))
    .digest('hex')
    .slice(0, 16);
}

/**
 * Build the `snapshot` field for a config_history row. Caller owns the
 * transaction + the version increment.
 */
export function buildConfigHistorySnapshotShape(params: {
  proposedConfig: Record<string, unknown>;
  path: string;
  reason: string;
  sourceSession?: string | null;
}): {
  snapshot: Record<string, unknown>;
  changeSummary: string;
} {
  return {
    snapshot: params.proposedConfig,
    changeSummary: `config_agent:${params.path} — ${params.reason}`.slice(0, 500),
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────

function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

function stringifyStable(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(stringifyStable).join(',')}]`;
  const keys = Object.keys(v as Record<string, unknown>).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stringifyStable((v as Record<string, unknown>)[k])}`).join(',')}}`;
}
