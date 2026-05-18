// server/services/scorecardService.ts
// Impure scorecard service — DB-backed CRUD + attach/detach lifecycle.
// Trust & Verification Layer spec §6.4, §12.1, §12.2.
// All methods MUST be called inside an active withOrgTx block.

import { eq, and, isNull, desc } from 'drizzle-orm';
import { getOrgScopedDb } from '../lib/orgScopedDb.js';
import { scorecards, agentScorecardAttachments, agents, organisations, systemAgents, subaccountAgents } from '../db/schema/index.js';
import type { Scorecard, NewScorecard } from '../db/schema/scorecards.js';
import type { AgentScorecardAttachment } from '../db/schema/agentScorecardAttachments.js';
import type { CreateScorecardInput, UpdateScorecardInput, DuplicateScorecardInput } from '../schemas/scorecards.js';
import { applyVisibilityRules, resolveAttachAuthority, assertAgentSubaccountMembership } from './scorecardServicePure.js';

// ── Viewer context passed in from routes ──────────────────────────────────────

export type ScorecardViewerCtx = {
  viewerScope: 'system_admin' | 'org_admin' | 'subaccount';
  orgId: string;
  subaccountId: string | null;
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function throwConflict(errorCode: string, message: string): never {
  const err = new Error(message) as Error & { statusCode: number; errorCode: string };
  err.statusCode = 409;
  err.errorCode = errorCode;
  throw err;
}

function throwForbidden(errorCode: string, message: string): never {
  const err = new Error(message) as Error & { statusCode: number; errorCode: string };
  err.statusCode = 403;
  err.errorCode = errorCode;
  throw err;
}

function throwUnprocessable(errorCode: string, message: string): never {
  const err = new Error(message) as Error & { statusCode: number; errorCode: string };
  err.statusCode = 422;
  err.errorCode = errorCode;
  throw err;
}

function throwNotFound(): never {
  const err = new Error('Not found') as Error & { statusCode: number };
  err.statusCode = 404;
  throw err;
}

function isDuplicateNameError(e: unknown): boolean {
  return typeof e === 'object' && e !== null && 'code' in e && (e as { code: string }).code === '23505';
}

// ── Service ───────────────────────────────────────────────────────────────────

export const scorecardService = {
  // ─── List ─────────────────────────────────────────────────────────────────

  async list(viewerCtx: ScorecardViewerCtx): Promise<Scorecard[]> {
    const db = getOrgScopedDb('scorecardService.list');
    // guard-ignore-next-line: with-org-tx-or-scoped-db reason="false positive: db is result of getOrgScopedDb call within this function — tenant-scoped"
    const all = await db
      .select()
      .from(scorecards)
      .orderBy(desc(scorecards.createdAt));
    return applyVisibilityRules({
      scorecards: all,
      viewerScope: viewerCtx.viewerScope,
      viewerOrgId: viewerCtx.orgId,
      viewerSubaccountId: viewerCtx.subaccountId,
    });
  },

  // ─── Get by ID ────────────────────────────────────────────────────────────

  async getById(id: string): Promise<Scorecard | null> {
    const db = getOrgScopedDb('scorecardService.getById');
    // guard-ignore-next-line: with-org-tx-or-scoped-db reason="false positive: db is result of getOrgScopedDb call within this function — tenant-scoped"
    const rows = await db
      .select()
      .from(scorecards)
      .where(eq(scorecards.id, id));
    return rows[0] ?? null;
  },

  // ─── Create ───────────────────────────────────────────────────────────────

  async create(
    input: CreateScorecardInput,
    scopeType: 'org' | 'subaccount',
    scopeId: string | null,
    orgId: string,
  ): Promise<Scorecard> {
    const db = getOrgScopedDb('scorecardService.create');
    const newRow: NewScorecard = {
      organisationId: orgId,
      scopeType,
      scopeId: scopeId ?? null,
      name: input.name,
      description: input.description ?? null,
      qualityChecks: input.qualityChecks ?? [],
      shareWithSubaccounts: input.shareWithSubaccounts ?? false,
      judgeModelId: input.judgeModelId ?? null,
    };
    try {
      // guard-ignore-next-line: with-org-tx-or-scoped-db reason="false positive: db is result of getOrgScopedDb call within this function — tenant-scoped"
      const rows = await db.insert(scorecards).values(newRow).returning();
      return rows[0];
    } catch (e) {
      if (isDuplicateNameError(e)) {
        throwUnprocessable('SCORECARD_NAME_TAKEN', 'A scorecard with this name already exists in this scope.');
      }
      throw e;
    }
  },

  // ─── Update ───────────────────────────────────────────────────────────────

  async update(id: string, patch: UpdateScorecardInput): Promise<Scorecard> {
    const db = getOrgScopedDb('scorecardService.update');
    const updateValues: Partial<NewScorecard> & { updatedAt: Date } = {
      updatedAt: new Date(),
      ...(patch.name !== undefined && { name: patch.name }),
      ...(patch.description !== undefined && { description: patch.description }),
      ...(patch.qualityChecks !== undefined && { qualityChecks: patch.qualityChecks }),
      ...(patch.shareWithSubaccounts !== undefined && { shareWithSubaccounts: patch.shareWithSubaccounts }),
      ...(patch.judgeModelId !== undefined && { judgeModelId: patch.judgeModelId }),
    };
    try {
      // guard-ignore-next-line: with-org-tx-or-scoped-db reason="false positive: db is result of getOrgScopedDb call within this function — tenant-scoped"
      const rows = await db
        .update(scorecards)
        .set(updateValues)
        .where(and(eq(scorecards.id, id), isNull(scorecards.deletedAt)))
        .returning();
      if (rows.length === 0) throwNotFound();
      return rows[0];
    } catch (e) {
      if (isDuplicateNameError(e)) {
        throwUnprocessable('SCORECARD_NAME_TAKEN', 'A scorecard with this name already exists in this scope.');
      }
      throw e;
    }
  },

  // ─── Soft delete ──────────────────────────────────────────────────────────

  async delete(id: string): Promise<void> {
    const db = getOrgScopedDb('scorecardService.delete');
    // Prevent deleting scorecards with active mandatory attachments
    // guard-ignore-next-line: with-org-tx-or-scoped-db reason="false positive: db is result of getOrgScopedDb call within this function — tenant-scoped"
    const attachments = await db
      .select()
      .from(agentScorecardAttachments)
      .where(eq(agentScorecardAttachments.scorecardId, id));
    const hasMandatory = attachments.some(
      a => a.attachAuthority === 'system_mandatory' || a.attachAuthority === 'org_mandatory',
    );
    if (hasMandatory) {
      throwForbidden('ATTACH_AUTHORITY_VIOLATION', 'Cannot delete a scorecard with mandatory attachments.');
    }
    // guard-ignore-next-line: with-org-tx-or-scoped-db reason="false positive: db is result of getOrgScopedDb call within this function — tenant-scoped"
    const rows = await db
      .update(scorecards)
      .set({ deletedAt: new Date() })
      .where(and(eq(scorecards.id, id), isNull(scorecards.deletedAt)))
      .returning();
    if (rows.length === 0) throwNotFound();
  },

  // ─── Duplicate ────────────────────────────────────────────────────────────

  async duplicate(sourceId: string, input: DuplicateScorecardInput, orgId: string): Promise<Scorecard> {
    const source = await scorecardService.getById(sourceId);
    if (!source || source.deletedAt) throwNotFound();
    return scorecardService.create(
      {
        name: input.name ?? `${source.name} (copy)`,
        description: source.description ?? undefined,
        qualityChecks: source.qualityChecks,
        shareWithSubaccounts: source.shareWithSubaccounts,
        judgeModelId: source.judgeModelId ?? undefined,
      },
      input.targetScopeType,
      input.targetScopeId ?? null,
      orgId,
    );
  },

  // ─── Share toggle ─────────────────────────────────────────────────────────

  async toggleShareWithSubaccounts(id: string, value: boolean): Promise<Scorecard> {
    const db = getOrgScopedDb('scorecardService.toggleShareWithSubaccounts');
    // guard-ignore-next-line: with-org-tx-or-scoped-db reason="false positive: db is result of getOrgScopedDb call within this function — tenant-scoped"
    const rows = await db
      .update(scorecards)
      .set({ shareWithSubaccounts: value, updatedAt: new Date() })
      .where(and(eq(scorecards.id, id), isNull(scorecards.deletedAt)))
      .returning();
    if (rows.length === 0) throwNotFound();
    return rows[0];
  },

  // ─── Attach to agent ─────────────────────────────────────────────────────

  async attachToAgent(
    agentId: string,
    scorecardId: string,
    orgId: string,
    opts: {
      gradingFrequency?: 'off' | 'q1' | 'q2' | 'q3';
    } = {},
  ): Promise<AgentScorecardAttachment> {
    const db = getOrgScopedDb('scorecardService.attachToAgent');

    // Load scorecard (name is used as the stable slug key per data model)
    const sc = await scorecardService.getById(scorecardId);
    if (!sc || sc.deletedAt) throwNotFound();

    // Load the agent to get its system agent FK
    // guard-ignore-next-line: with-org-tx-or-scoped-db reason="false positive: db is result of getOrgScopedDb call within this function — tenant-scoped"
    const agentRows = await db
      .select({ id: agents.id, systemAgentId: agents.systemAgentId })
      .from(agents)
      .where(and(eq(agents.id, agentId), isNull(agents.deletedAt)));
    if (agentRows.length === 0) throwNotFound();
    const agent = agentRows[0];

    // Load org mandatory slugs
    // guard-ignore-next-line: with-org-tx-or-scoped-db reason="false positive: db is result of getOrgScopedDb call within this function — tenant-scoped"
    const orgRows = await db
      .select({ orgMandatoryScorecardSlugs: organisations.orgMandatoryScorecardSlugs })
      .from(organisations)
      .where(eq(organisations.id, orgId));
    const orgMandatorySlugs = orgRows[0]?.orgMandatoryScorecardSlugs ?? [];

    // Load system agent defaults if the agent has a system agent parent
    let systemAgentDefaults: { default_system_scorecard_slugs: string[]; default_org_scorecard_slugs: string[] } | null = null;
    if (agent.systemAgentId) {
      // guard-ignore-next-line: with-org-tx-or-scoped-db reason="false positive: db is result of getOrgScopedDb call within this function — tenant-scoped"
      const saRows = await db
        .select({
          defaultSystemScorecardSlugs: systemAgents.defaultSystemScorecardSlugs,
          defaultOrgScorecardSlugs: systemAgents.defaultOrgScorecardSlugs,
        })
        .from(systemAgents)
        .where(eq(systemAgents.id, agent.systemAgentId));
      if (saRows[0]) {
        systemAgentDefaults = {
          default_system_scorecard_slugs: saRows[0].defaultSystemScorecardSlugs ?? [],
          default_org_scorecard_slugs: saRows[0].defaultOrgScorecardSlugs ?? [],
        };
      }
    }

    const authority = resolveAttachAuthority({
      scorecardSlug: sc.name,
      systemAgentDefaults,
      orgMandatorySlugs,
      agentTemplateDefaults: null,
      operatorChecked: true,
    });

    try {
      // guard-ignore-next-line: with-org-tx-or-scoped-db reason="false positive: db is result of getOrgScopedDb call within this function — tenant-scoped"
      const rows = await db
        .insert(agentScorecardAttachments)
        .values({
          organisationId: orgId,
          agentId,
          scorecardId,
          attachAuthority: authority,
          gradingFrequency: opts.gradingFrequency ?? 'q1',
        })
        .returning();
      return rows[0];
    } catch (e) {
      if (isDuplicateNameError(e)) {
        throwConflict('SCORECARD_ALREADY_ATTACHED', 'This scorecard is already attached to the agent.');
      }
      throw e;
    }
  },

  // ─── Detach from agent ────────────────────────────────────────────────────

  async detachFromAgent(
    agentId: string,
    scorecardId: string,
    callerScope: 'system_admin' | 'org_admin' | 'subaccount',
  ): Promise<void> {
    const db = getOrgScopedDb('scorecardService.detachFromAgent');
    // guard-ignore-next-line: with-org-tx-or-scoped-db reason="false positive: db is result of getOrgScopedDb call within this function — tenant-scoped"
    const rows = await db
      .select()
      .from(agentScorecardAttachments)
      .where(
        and(
          eq(agentScorecardAttachments.agentId, agentId),
          eq(agentScorecardAttachments.scorecardId, scorecardId),
        ),
      );
    const attachment = rows[0];
    if (!attachment) throwNotFound();

    // Authority enforcement: only system_admin can detach system_mandatory;
    // org_admin can detach org_mandatory or suggested; subaccount can only detach suggested.
    if (attachment.attachAuthority === 'system_mandatory' && callerScope !== 'system_admin') {
      throwForbidden('ATTACH_AUTHORITY_VIOLATION', 'Only a system admin can detach a system-mandatory scorecard.');
    }
    if (attachment.attachAuthority === 'org_mandatory' && callerScope === 'subaccount') {
      throwForbidden('ATTACH_AUTHORITY_VIOLATION', 'Only an org admin or system admin can detach an org-mandatory scorecard.');
    }

    // guard-ignore-next-line: with-org-tx-or-scoped-db reason="false positive: db is result of getOrgScopedDb call within this function — tenant-scoped"
    await db
      .delete(agentScorecardAttachments)
      .where(eq(agentScorecardAttachments.id, attachment.id));
  },

  // ─── Cross-subaccount IDOR guard ──────────────────────────────────────────
  //
  // Trust & Verification Layer spec §12.2 + adversarial-review S-3.
  //
  // The subaccount-scoped attach/detach routes carry both :subaccountId and
  // :agentId in the URL. RLS protects writes from crossing org boundaries
  // but does NOT block within-org cross-subaccount targeting (e.g. a power
  // user in subaccount A calling DELETE with :agentId pointing at an agent
  // owned by subaccount B in the same org). This service-layer guard
  // verifies an active subaccount_agents link exists before the route
  // proceeds.
  //
  // Pure verdict shaping lives in `assertAgentSubaccountMembership` so the
  // route → HTTP status mapping (403 AGENT_NOT_IN_SUBACCOUNT) is testable.

  async assertAgentInSubaccount(agentId: string, subaccountId: string): Promise<void> {
    const db = getOrgScopedDb('scorecardService.assertAgentInSubaccount');
    // guard-ignore-next-line: with-org-tx-or-scoped-db reason="false positive: db is result of getOrgScopedDb call within this function — tenant-scoped"
    const rows = await db
      .select({ id: subaccountAgents.id })
      .from(subaccountAgents)
      .where(
        and(
          eq(subaccountAgents.agentId, agentId),
          eq(subaccountAgents.subaccountId, subaccountId),
          eq(subaccountAgents.isActive, true),
        ),
      )
      .limit(1);

    const verdict = assertAgentSubaccountMembership({ hasActiveLink: rows.length > 0 });
    if (verdict !== 'ok') {
      throwForbidden('AGENT_NOT_IN_SUBACCOUNT', 'Agent does not belong to this subaccount.');
    }
  },

  // ─── List for agent ───────────────────────────────────────────────────────

  async listForAgent(agentId: string): Promise<Array<AgentScorecardAttachment & { scorecard: Scorecard }>> {
    const db = getOrgScopedDb('scorecardService.listForAgent');
    // guard-ignore-next-line: with-org-tx-or-scoped-db reason="false positive: db is result of getOrgScopedDb call within this function — tenant-scoped"
    const rows = await db
      .select({
        attachment: agentScorecardAttachments,
        scorecard: scorecards,
      })
      .from(agentScorecardAttachments)
      .innerJoin(scorecards, eq(scorecards.id, agentScorecardAttachments.scorecardId))
      .where(
        and(
          eq(agentScorecardAttachments.agentId, agentId),
          isNull(scorecards.deletedAt),
        ),
      )
      .orderBy(desc(agentScorecardAttachments.attachedAt));
    return rows.map(r => ({ ...r.attachment, scorecard: r.scorecard }));
  },
};
