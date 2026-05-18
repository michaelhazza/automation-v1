import { sql } from 'drizzle-orm';
import { getOrgScopedDb } from '../lib/orgScopedDb.js';
import type { AmendmentKind } from '../../shared/types/skillAmendments.js';

// ── Response shape (mirrors client-side SnapshotSummary) ─────────────────────

export interface SnapshotAmendmentIncluded {
  id: string;
  kind: AmendmentKind;
  activatedAt: string;
  bodyPreview: string;
}

export interface SnapshotAmendmentExcluded {
  id: string;
  retirementReason: string | null;
}

export interface SnapshotSummary {
  resolverVersion: string;
  composedSizeChars: number;
  amendmentVersionSetHash: string;
  includedAmendments: SnapshotAmendmentIncluded[];
  excludedAmendments: SnapshotAmendmentExcluded[];
  truncated: boolean;
}

// ── Raw DB row shapes ─────────────────────────────────────────────────────────

type SnapshotRow = {
  resolver_version: string;
  composed_size_chars: number;
  amendment_version_set_hash: string;
  included_amendment_ids: string[];
  excluded_amendment_ids: string[];
  truncated: boolean;
};

type AmendmentRow = {
  id: string;
  kind: string;
  activated_at: Date | null;
  body: string;
  retirement_reason: string | null;
};

// ── Service ───────────────────────────────────────────────────────────────────

export const skillCompositionSnapshotService = {
  async getForRun(runId: string, orgId: string): Promise<SnapshotSummary | null> {
    const db = getOrgScopedDb('skillCompositionSnapshotService.getForRun');

    // Fetch the first snapshot row for this run. Most runs resolve one skill
    // per run; if multiple snapshots exist, we return a merged view.
    const snapshots = await db.execute(sql`
      SELECT
        resolver_version,
        composed_size_chars,
        amendment_version_set_hash,
        included_amendment_ids,
        excluded_amendment_ids,
        truncated
      FROM skill_amendment_run_snapshot
      WHERE run_id = ${runId}::uuid
        AND org_id = ${orgId}::uuid
      LIMIT 1
    `) as unknown as SnapshotRow[];

    if (snapshots.length === 0) {
      return null;
    }

    const snap = snapshots[0];
    const allIds = [...snap.included_amendment_ids, ...snap.excluded_amendment_ids];

    // Hydrate amendment metadata for included + excluded entries.
    let amendmentRows: AmendmentRow[] = [];
    if (allIds.length > 0) {
      const idList = allIds.map((id) => `'${id}'`).join(',');
      amendmentRows = await db.execute(sql.raw(`
        SELECT id::text, kind, activated_at, LEFT(body, 100) AS body, retirement_reason
        FROM skill_amendments
        WHERE id IN (${idList})
          AND org_id = '${orgId}'
      `)) as unknown as AmendmentRow[];
    }

    const amendmentMap = new Map(amendmentRows.map((r) => [r.id, r]));

    const includedAmendments: SnapshotAmendmentIncluded[] = snap.included_amendment_ids.map((id) => {
      const row = amendmentMap.get(id);
      return {
        id,
        kind: (row?.kind ?? 'instruction_extension') as AmendmentKind,
        activatedAt: row?.activated_at ? row.activated_at.toISOString() : new Date(0).toISOString(),
        bodyPreview: row?.body ?? '',
      };
    });

    const excludedAmendments: SnapshotAmendmentExcluded[] = snap.excluded_amendment_ids.map((id) => {
      const row = amendmentMap.get(id);
      return {
        id,
        retirementReason: row?.retirement_reason ?? null,
      };
    });

    return {
      resolverVersion: snap.resolver_version,
      composedSizeChars: snap.composed_size_chars,
      amendmentVersionSetHash: snap.amendment_version_set_hash,
      includedAmendments,
      excludedAmendments,
      truncated: snap.truncated,
    };
  },
};
