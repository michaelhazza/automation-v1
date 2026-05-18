// operatorSessionInitialContextBundler.ts — Impure orchestrator.
//
// Reads raw inputs from DB, then delegates to the pure trim function.
//
// Spec: docs/superpowers/specs/2026-05-13-personal-assistant-v2-operator-spec.md §4.2, §5.8

import { eq, and, isNull, desc } from 'drizzle-orm';
import { getOrgScopedDb } from '../lib/orgScopedDb.js';
import { memoryBlocks, subaccountAgents } from '../db/schema/index.js';
import { voiceProfiles as voiceProfilesTable } from '../db/schema/voiceProfiles.js';
import { logger } from '../lib/logger.js';
import {
  buildBundle,
  isConfigDegraded,
  type BundleRawInputs,
  type OperatorSessionInitialContextBundle,
} from './operatorSessionInitialContextBundlerPure.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MEMORY_BLOCK_PRE_CAP = 20;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface OperatorSessionBundleInput {
  agentId: string;
  ownerUserId: string;
  subaccountAgentId: string;
  organisationId: string;
  subaccountId: string;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export const operatorSessionInitialContextBundler = {
  async build(input: OperatorSessionBundleInput): Promise<OperatorSessionInitialContextBundle> {
    const db = getOrgScopedDb('operatorSessionInitialContextBundler.build');

    // ── 1. Memory blocks ────────────────────────────────────────────────────
    let rawMemoryBlocks: BundleRawInputs['memory_blocks'] = [];
    try {
      // guard-ignore-next-line: with-org-tx-or-scoped-db reason="false positive: db is result of getOrgScopedDb call within this function — tenant-scoped"
      const rows = await db
        .select({
          name: memoryBlocks.name,
          content: memoryBlocks.content,
          updatedAt: memoryBlocks.updatedAt,
        })
        .from(memoryBlocks)
        .where(
          and(
            eq(memoryBlocks.ownerAgentId, input.agentId),
            eq(memoryBlocks.status, 'active'),
            isNull(memoryBlocks.deletedAt),
          ),
        )
        .orderBy(desc(memoryBlocks.updatedAt))
        .limit(MEMORY_BLOCK_PRE_CAP);

      rawMemoryBlocks = rows.map((r) => ({
        label: r.name,
        content: r.content,
        updated_at: r.updatedAt.toISOString(),
      }));
    } catch (err) {
      logger.warn('operatorSessionInitialContextBundler.build: memory_blocks read failed', {
        agentId: input.agentId,
        error: String(err),
      });
    }

    // ── 2. Voice profile ────────────────────────────────────────────────────
    let rawVoiceProfile: BundleRawInputs['voice_profile'] = null;
    try {
      // guard-ignore-next-line: with-org-tx-or-scoped-db reason="false positive: db is result of getOrgScopedDb call within this function — tenant-scoped"
      const [vpRow] = await db
        .select({ profileJson: voiceProfilesTable.profileJson })
        .from(voiceProfilesTable)
        .where(
          and(
            eq(voiceProfilesTable.ownerUserId, input.ownerUserId),
            eq(voiceProfilesTable.organisationId, input.organisationId),
            eq(voiceProfilesTable.state, 'ready'),
            isNull(voiceProfilesTable.optOutAt),
          ),
        )
        .orderBy(desc(voiceProfilesTable.lastDerivedAt))
        .limit(1);

      if (vpRow?.profileJson) {
        const json = vpRow.profileJson as {
          tone_features?: unknown;
          style_markers?: unknown;
          do_not_use?: unknown;
          canonical_examples?: unknown;
        };
        rawVoiceProfile = {
          tone_features: Array.isArray(json.tone_features) ? (json.tone_features as string[]) : [],
          style_markers: Array.isArray(json.style_markers) ? (json.style_markers as string[]) : [],
          do_not_use: Array.isArray(json.do_not_use) ? (json.do_not_use as string[]) : [],
          canonical_examples: Array.isArray(json.canonical_examples) ? (json.canonical_examples as string[]) : [],
        };
      }
    } catch (err) {
      logger.warn('operatorSessionInitialContextBundler.build: voice_profile read failed', {
        ownerUserId: input.ownerUserId,
        error: String(err),
      });
    }

    // ── 3. Timezone (from subaccountAgents) ─────────────────────────────────
    let timezone = 'UTC';
    try {
      // guard-ignore-next-line: with-org-tx-or-scoped-db reason="false positive: db is result of getOrgScopedDb call within this function — tenant-scoped"
      const [saRow] = await db
        .select({ scheduleTimezone: subaccountAgents.scheduleTimezone })
        .from(subaccountAgents)
        .where(eq(subaccountAgents.id, input.subaccountAgentId))
        .limit(1);

      if (!saRow) {
        logger.warn('operatorSessionInitialContextBundler.build: subaccountAgent not found, falling back to UTC', {
          subaccountAgentId: input.subaccountAgentId,
        });
      } else {
        timezone = saRow.scheduleTimezone;
      }
    } catch (err) {
      logger.warn('operatorSessionInitialContextBundler.build: timezone read failed, falling back to UTC', {
        subaccountAgentId: input.subaccountAgentId,
        error: String(err),
      });
    }

    // ── 4. Assemble raw inputs ───────────────────────────────────────────────
    const rawInputs: BundleRawInputs = {
      voice_profile: rawVoiceProfile,
      memory_blocks: rawMemoryBlocks,
      owner_identity: {
        timezone,
        working_hours: null,
        // recent_activity_summary intentionally omitted (deferred)
      },
    };

    // ── 5. Trim and return ───────────────────────────────────────────────────
    const bundle = buildBundle(rawInputs);

    if (isConfigDegraded(bundle)) {
      logger.warn('operatorSessionInitialContextBundler.build: bundle config degraded (voice_profile too large)', {
        organisationId: input.organisationId,
        agentId: input.agentId,
      });
    }

    return bundle;
  },
};
