import type { SkillExecutionContext, SkillHandler } from '../context.js';

function buildSupportPrincipal(context: SkillExecutionContext): import('../../principal/types.js').PrincipalContext {
  return {
    type: 'service',
    id: context.agentId,
    organisationId: context.organisationId,
    subaccountId: context.subaccountId,
    serviceId: 'support-skill',
    teamIds: [],
  };
}

export const supportHandlers: Record<string, SkillHandler> = {
  'support.list_open_tickets': async (input: Record<string, unknown>, context: SkillExecutionContext) => {
    const { listOpenTickets } = await import('../../supportTicketService.js');
    const principal = buildSupportPrincipal(context);
    const tickets = await listOpenTickets(
      {
        inboxIds: input.inboxIds as string[] | undefined,
        statusGroup: input.statusGroup as 'needs_attention' | 'all_open' | 'quarantined' | undefined,
      },
      principal,
    );
    return { success: true, tickets };
  },

  'support.read_thread': async (input: Record<string, unknown>, context: SkillExecutionContext) => {
    const { readThreadForAgent } = await import('../../supportTicketService.js');
    const principal = buildSupportPrincipal(context);
    const result = await readThreadForAgent(input.ticketId as string, principal);
    return { success: true, ...result };
  },

  'support.propose_reply': async (input: Record<string, unknown>, context: SkillExecutionContext) => {
    const { proposeReply } = await import('../../supportDraftDispatchService.js');
    const principal = buildSupportPrincipal(context);
    const draft = await proposeReply(
      {
        ticketId: input.ticketId as string,
        body: input.body as string,
        visibility: 'public',
        proposedActions: input.proposedActions as import('../../../../shared/types/supportProposedActions.js').SupportProposedActions | undefined,
        runId: context.runId,
      },
      principal,
    );
    return { success: true, draft };
  },

  'support.add_internal_note': async (input: Record<string, unknown>, context: SkillExecutionContext) => {
    const { proposeReply } = await import('../../supportDraftDispatchService.js');
    const principal = buildSupportPrincipal(context);
    const draft = await proposeReply(
      {
        ticketId: input.ticketId as string,
        body: input.body as string,
        visibility: 'internal',
        runId: context.runId,
      },
      principal,
    );
    return { success: true, draft };
  },

  'support.approve_draft': async (input: Record<string, unknown>, context: SkillExecutionContext) => {
    const { approveDraft } = await import('../../supportDraftDispatchService.js');
    const principal = buildSupportPrincipal(context);
    const result = await approveDraft(input.draftId as string, principal, {
      reviewNotes: input.reviewNotes as string | undefined,
    });
    return { success: true, ...result };
  },

  'support.reject_draft': async (input: Record<string, unknown>, context: SkillExecutionContext) => {
    const { rejectDraft } = await import('../../supportDraftDispatchService.js');
    const principal = buildSupportPrincipal(context);
    await rejectDraft(input.draftId as string, principal, input.reason as string);
    return { success: true };
  },

  'support.set_status': async (input: Record<string, unknown>, context: SkillExecutionContext) => {
    const { applyStatusChange } = await import('../../supportTicketService.js');
    const principal = buildSupportPrincipal(context);
    await applyStatusChange(
      input.ticketId as string,
      input.status as import('../../../adapters/integrationAdapter.js').SupportCanonicalStatus,
      principal,
    );
    return { success: true };
  },

  'support.assign': async (input: Record<string, unknown>, context: SkillExecutionContext) => {
    const { applyAssignmentChange } = await import('../../supportTicketService.js');
    const principal = buildSupportPrincipal(context);
    await applyAssignmentChange(
      input.ticketId as string,
      input.assigneeAgentExternalId as string | null,
      principal,
    );
    return { success: true };
  },

  'support.tag': async (input: Record<string, unknown>, context: SkillExecutionContext) => {
    const { applyTagMutation } = await import('../../supportTicketService.js');
    const principal = buildSupportPrincipal(context);
    await applyTagMutation(
      input.ticketId as string,
      {
        addTags: input.addTags as string[] | undefined,
        removeTags: input.removeTags as string[] | undefined,
      },
      principal,
    );
    return { success: true };
  },

  'support.find_customer_history': async (input: Record<string, unknown>, context: SkillExecutionContext) => {
    const { eq, and, inArray: inArr } = await import('drizzle-orm');
    const { getOrgScopedDb } = await import('../../../lib/orgScopedDb.js');
    const {
      canonicalContacts, // verify-canonical-read-interface: allowed
      canonicalTickets: ctTickets,
      canonicalRevenue, // verify-canonical-read-interface: allowed
      canonicalAccounts, // verify-canonical-read-interface: allowed
    } = await import('../../../db/schema/index.js');
    const db = getOrgScopedDb('support.find_customer_history');
    // guard-ignore-next-line: with-org-tx-or-scoped-db reason="false positive: db is result of getOrgScopedDb call within this function — tenant-scoped"
    const contacts = await db
      .select()
      .from(canonicalContacts) // verify-canonical-read-interface: allowed
      .where(and(
        eq(canonicalContacts.organisationId, context.organisationId), // verify-canonical-read-interface: allowed
        eq(canonicalContacts.email, input.email as string), // verify-canonical-read-interface: allowed
      ));
    if (contacts.length === 0) return { success: true, contacts: [], tickets: [], revenue: [], accounts: [] };
    const contactIds = contacts.map((c) => c.id);
    const accountIds = [...new Set(contacts.map((c) => c.accountId))];
    // guard-ignore-next-line: with-org-tx-or-scoped-db reason="false positive: db is result of getOrgScopedDb call within this function — tenant-scoped"
    const tickets = await db
      .select()
      .from(ctTickets)
      .where(and(
        eq(ctTickets.organisationId, context.organisationId),
        inArr(ctTickets.canonicalContactId, contactIds),
      ))
      .orderBy(ctTickets.openedAt);
    // guard-ignore-next-line: with-org-tx-or-scoped-db reason="false positive: db is result of getOrgScopedDb call within this function — tenant-scoped"
    const revenue = await db
      .select()
      .from(canonicalRevenue) // verify-canonical-read-interface: allowed
      .where(and(
        eq(canonicalRevenue.organisationId, context.organisationId), // verify-canonical-read-interface: allowed
        inArr(canonicalRevenue.accountId, accountIds), // verify-canonical-read-interface: allowed
      ));
    // guard-ignore-next-line: with-org-tx-or-scoped-db reason="false positive: db is result of getOrgScopedDb call within this function — tenant-scoped"
    const accounts = await db
      .select()
      .from(canonicalAccounts) // verify-canonical-read-interface: allowed
      .where(and(
        eq(canonicalAccounts.organisationId, context.organisationId), // verify-canonical-read-interface: allowed
        inArr(canonicalAccounts.id, accountIds), // verify-canonical-read-interface: allowed
      ));
    return { success: true, contacts, tickets, revenue, accounts };
  },

  'support.classify_ticket': async (input: Record<string, unknown>, context: SkillExecutionContext) => {
    const { classifyTicket } = await import('../../skillHandlers/supportClassifyTicket.js');
    return classifyTicket({
      organisationId: context.organisationId,
      ticketId: String(input.ticketId ?? ''),
      runId: context.runId,
    });
  },
};
