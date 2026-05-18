import { createHash } from 'crypto';
import { sql } from 'drizzle-orm';
import type { OrgScopedTx } from '../../db/index.js';
import type { ComposeAmendmentsResult, ResolverError } from './types.js';

export function hashComposedBody(body: string): string {
  return createHash('sha256').update(body, 'utf8').digest('hex');
}

function sortedSet(ids: string[]): string[] {
  return [...ids].sort();
}

function setsEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const sa = sortedSet(a);
  const sb = sortedSet(b);
  return sa.every((v, i) => v === sb[i]);
}

type SnapshotRow = {
  composed_body_hash: string;
  included_amendment_ids: string[];
  excluded_amendment_ids: string[];
  truncated: boolean;
  resolver_version: string;
};

export async function writeRunSnapshot(args: {
  tx: OrgScopedTx;
  runId: string;
  orgId: string;
  systemSkillId: string | null;
  orgSkillId: string | null;
  resolverVersion: string;
  result: ComposeAmendmentsResult;
  composedBodyHash: string;
}): Promise<{ outcome: 'inserted' | 'matched_existing' }> {
  const {
    tx, runId, orgId, systemSkillId, orgSkillId, resolverVersion, result, composedBodyHash,
  } = args;

  // Build array literals as sql fragments — UUIDs are trusted DB values (v4 hex).
  const includedLiteral = result.includedAmendmentIds.length > 0
    ? sql.raw(`ARRAY['${result.includedAmendmentIds.join("','")}']::uuid[]`)
    : sql.raw(`'{}'::uuid[]`);
  const excludedLiteral = result.excludedAmendmentIds.length > 0
    ? sql.raw(`ARRAY['${result.excludedAmendmentIds.join("','")}']::uuid[]`)
    : sql.raw(`'{}'::uuid[]`);

  let rows: SnapshotRow[];

  try {
    const rawResult = await tx.execute(sql`
      INSERT INTO skill_amendment_run_snapshot (
        run_id, org_id, system_skill_id, org_skill_id,
        resolver_version, amendment_version_set_hash,
        composed_body, composed_body_hash,
        included_amendment_ids, excluded_amendment_ids,
        composed_size_chars, truncated
      ) VALUES (
        ${runId}::uuid,
        ${orgId}::uuid,
        ${systemSkillId}::uuid,
        ${orgSkillId}::uuid,
        ${resolverVersion},
        ${result.amendmentVersionSetHash},
        ${result.composedBody},
        ${composedBodyHash},
        ${includedLiteral},
        ${excludedLiteral},
        ${result.composedSizeChars},
        ${result.truncated}
      )
      ON CONFLICT (run_id, system_skill_id, org_skill_id) DO NOTHING
      RETURNING composed_body_hash, included_amendment_ids, excluded_amendment_ids, truncated, resolver_version
    `);
    rows = rawResult as unknown as SnapshotRow[];
  } catch (err: unknown) {
    const errorCode = (err as { code?: string }).code ?? 'unknown';
    const resolverErr: ResolverError = {
      kind: 'composition.snapshot_write_failed',
      runId,
      orgId,
      skillId: systemSkillId ?? orgSkillId ?? '',
      dbErrorCode: errorCode,
      attemptCount: 1,
    };
    throw resolverErr;
  }

  // Row returned → fresh insert succeeded.
  if (rows.length > 0) {
    return { outcome: 'inserted' };
  }

  // Conflict (DO NOTHING) → fetch existing row for divergence check.
  const existingResult = await tx.execute(sql`
    SELECT composed_body_hash, included_amendment_ids, excluded_amendment_ids, truncated, resolver_version
    FROM skill_amendment_run_snapshot
    WHERE run_id = ${runId}::uuid
      AND (system_skill_id IS NOT DISTINCT FROM ${systemSkillId}::uuid)
      AND (org_skill_id IS NOT DISTINCT FROM ${orgSkillId}::uuid)
    LIMIT 1
  `);

  const existing = (existingResult as unknown as SnapshotRow[])[0];

  const hashMatch = existing.composed_body_hash === composedBodyHash;
  const includedMatch = setsEqual(existing.included_amendment_ids, result.includedAmendmentIds);
  const excludedMatch = setsEqual(existing.excluded_amendment_ids, result.excludedAmendmentIds);
  const truncatedMatch = existing.truncated === result.truncated;

  if (hashMatch && includedMatch && excludedMatch && truncatedMatch) {
    return { outcome: 'matched_existing' };
  }

  // Values differ → divergence error (non-retryable integrity violation).
  const existingIncluded = sortedSet(existing.included_amendment_ids);
  const currentIncluded = sortedSet(result.includedAmendmentIds);
  const existingExcluded = sortedSet(existing.excluded_amendment_ids);
  const currentExcluded = sortedSet(result.excludedAmendmentIds);

  const resolverErr: ResolverError = {
    kind: 'composition.divergence',
    runId,
    orgId,
    skillId: systemSkillId ?? orgSkillId ?? '',
    existingResolverVersion: existing.resolver_version,
    currentResolverVersion: resolverVersion,
    existingHash: existing.composed_body_hash,
    currentHash: composedBodyHash,
    includedDiff: {
      added: currentIncluded.filter(id => !existingIncluded.includes(id)),
      removed: existingIncluded.filter(id => !currentIncluded.includes(id)),
    },
    excludedDiff: {
      added: currentExcluded.filter(id => !existingExcluded.includes(id)),
      removed: existingExcluded.filter(id => !currentExcluded.includes(id)),
    },
    truncatedDiff: {
      existing: existing.truncated,
      current: result.truncated,
    },
  };
  throw resolverErr;
}
