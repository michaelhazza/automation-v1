// Pure helpers for incident ingestion — no DB access, no logger import.
// All functions are deterministic and fully unit-testable.
import crypto from 'crypto';
import type { ErrorCategory } from './middleware/errorHandling.js';
import type { SystemIncidentClassification, SystemIncidentSeverity, SystemIncidentSource } from '../db/schema/systemIncidents.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface IncidentInput {
  source: SystemIncidentSource;
  severity?: SystemIncidentSeverity;
  classification?: SystemIncidentClassification;

  errorCode?: string;
  errorCategory?: ErrorCategory;
  statusCode?: number;
  summary: string;
  stack?: string;
  errorDetail?: Record<string, unknown>;

  organisationId?: string | null;
  subaccountId?: string | null;

  affectedResourceKind?: string;
  affectedResourceId?: string;

  correlationId?: string;

  // Integrations with a domain-stable identifier pass it here to bypass
  // stack-derived fingerprinting. Must match FINGERPRINT_OVERRIDE_RE.
  fingerprintOverride?: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// Binding contract: override must be domain:error-id[:optional-extra-parts]
// Uppercase is allowed in error-identifier components (e.g. CLASSIFICATION_PARSE_FAILURE).
export const FINGERPRINT_OVERRIDE_RE = /^[a-z_]+:[a-zA-Z0-9_.-]+(:[a-zA-Z0-9_.-]+)+$/;

const USER_FAULT_CATEGORIES: ReadonlySet<ErrorCategory> = new Set([
  'validation_error',
  'auth_error',
  'permission_failure',
  'not_found',
]);

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

export function classify(input: Pick<IncidentInput, 'classification' | 'errorCategory' | 'statusCode'>): SystemIncidentClassification {
  if (input.classification) return input.classification;
  if (input.errorCategory && USER_FAULT_CATEGORIES.has(input.errorCategory)) return 'user_fault';
  if (input.statusCode !== undefined && input.statusCode >= 400 && input.statusCode < 500) return 'user_fault';
  return 'system_fault';
}

// ---------------------------------------------------------------------------
// Default severity inference
// ---------------------------------------------------------------------------

export function inferDefaultSeverity(input: Pick<IncidentInput, 'source' | 'statusCode' | 'errorCode'> & { isSystemManagedAgent?: boolean }): SystemIncidentSeverity {
  if (input.source === 'route') {
    if (input.statusCode !== undefined && input.statusCode >= 500) return 'medium';
    if (input.statusCode !== undefined && [408, 409, 429].includes(input.statusCode)) return 'low';
    return 'medium';
  }
  if (input.source === 'job') return 'high';
  if (input.source === 'agent') {
    return input.isSystemManagedAgent ? 'high' : 'medium';
  }
  if (input.source === 'connector') return 'low';
  if (input.source === 'skill') return 'medium';
  if (input.source === 'llm') {
    if (input.errorCode === 'CLASSIFICATION_PARSE_FAILURE' || input.errorCode === 'RECONCILIATION_REQUIRED') {
      return 'high';
    }
    return 'medium';
  }
  if (input.source === 'self') return 'high';
  return 'medium';
}

// ---------------------------------------------------------------------------
// Fingerprinting
// ---------------------------------------------------------------------------

export function validateFingerprintOverride(override: string): boolean {
  return FINGERPRINT_OVERRIDE_RE.test(override);
}

export function hashFingerprint(input: string): string {
  return crypto.createHash('sha256').update(input).digest('hex').slice(0, 16);
}

export function normaliseMessage(msg: string): string {
  return msg
    // Strip UUIDs first (most specific pattern)
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '<uuid>')
    // Strip ISO timestamps before number stripping so the 4-digit year isn't eaten first
    .replace(/\d{4}-\d{2}-\d{2}T[\d:.Z+\-]+/g, '<timestamp>')
    // Strip remaining large standalone numbers (4+ digits)
    .replace(/\b\d{4,}\b/g, '<num>')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);
}

// Returns the top meaningful frame with line/column numbers stripped.
// This stabilises the fingerprint across deploys and minor refactors that
// shift frames by a few lines. Function name + file path are preserved.
export function topFrameSignature(stack: string | undefined): string {
  if (!stack) return 'no_stack';
  const lines = stack.split('\n').map(l => l.trim()).filter(l => l.startsWith('at '));
  // Skip frames from the ingestor itself and the logger to get the real caller
  const meaningful = lines.find(l =>
    !l.includes('incidentIngestor') &&
    !l.includes('lib/logger') &&
    !l.includes('node_modules')
  );
  const frame = meaningful ?? lines[0] ?? 'no_stack';
  // Strip ":line:col" suffixes in various formats:
  //   at fn (path/file.ts:42:18) → at fn (path/file.ts)
  //   at fn path/file.ts:42:18  → at fn path/file.ts
  return frame
    .replace(/:\d+:\d+\)/g, ')')
    .replace(/:\d+:\d+$/g, '')
    .replace(/:\d+\)/g, ')')
    .replace(/:\d+$/g, '')
    .slice(0, 200);
}

export function computeFingerprint(input: Pick<IncidentInput, 'source' | 'errorCode' | 'summary' | 'stack' | 'affectedResourceKind' | 'fingerprintOverride'>): string {
  if (input.fingerprintOverride) {
    return hashFingerprint(input.fingerprintOverride);
  }
  const parts = [
    input.source,
    input.errorCode ?? 'no_code',
    normaliseMessage(input.summary),
    topFrameSignature(input.stack),
    input.affectedResourceKind ?? 'no_resource',
  ].join('|');
  return hashFingerprint(parts);
}

// ---------------------------------------------------------------------------
// Severity escalation (never de-escalate within a single incident lifecycle)
// ---------------------------------------------------------------------------

const SEVERITY_RANK: Record<SystemIncidentSeverity, number> = {
  low: 0,
  medium: 1,
  high: 2,
  critical: 3,
};

export function maxSeverity(a: SystemIncidentSeverity, b: SystemIncidentSeverity): SystemIncidentSeverity {
  return SEVERITY_RANK[a] >= SEVERITY_RANK[b] ? a : b;
}

// ---------------------------------------------------------------------------
// Notification threshold check
// ---------------------------------------------------------------------------

const DEFAULT_NOTIFY_MILESTONES = [1, 10, 100, 1000];

export function shouldNotify(
  occurrenceCount: number,
  wasInserted: boolean,
  severity: SystemIncidentSeverity,
  milestonesEnv?: string,
): boolean {
  if (severity === 'low') return wasInserted; // only on first occurrence for low severity

  const milestones = milestonesEnv
    ? milestonesEnv.split(',').map(Number).filter(n => !isNaN(n) && n > 0)
    : DEFAULT_NOTIFY_MILESTONES;

  return milestones.includes(occurrenceCount);
}
