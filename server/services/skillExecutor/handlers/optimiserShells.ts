import type { SkillHandler } from '../context.js';
import { requireSubaccountContext } from '../context.js';
import { getOrgScopedDb } from '../../../lib/orgScopedDb.js';
import { logger } from '../../../lib/logger.js';

export const optimiserShellHandlers: Record<string, SkillHandler> = {
  'optimiser.scan_agent_budget': async (input, context) => {
    const subaccountId = requireSubaccountContext(context, 'optimiser.scan_agent_budget');
    try {
      const { module: agentBudgetModule } = await import('../../optimiser/queries/agentBudget.js');
      const { evaluate } = await import('../../optimiser/recommendations/agentBudget.js');
      const tx = getOrgScopedDb('optimiser.scan_agent_budget');
      const rows = await agentBudgetModule.run(tx, subaccountId);
      logger.info('optimiser.scan.completed', { scanCategory: agentBudgetModule.category, resultCount: rows.length, subaccountId });
      const outputs = evaluate(rows, { subaccountId, organisationId: context.organisationId, medianVersion: 0, priorRecsByDedupe: new Map() });
      return { success: true, outputs };
    } catch (err) {
      logger.error('optimiser.scan.failed', { scanCategory: 'optimiser.agent.over_budget', error: err instanceof Error ? err.message : String(err), subaccountId });
      throw err;
    }
  },

  'optimiser.scan_workflow_escalations': async (input, context) => {
    const subaccountId = requireSubaccountContext(context, 'optimiser.scan_workflow_escalations');
    try {
      const { module: escalationRateModule } = await import('../../optimiser/queries/escalationRate.js');
      const { evaluate } = await import('../../optimiser/recommendations/playbookEscalation.js');
      const tx = getOrgScopedDb('optimiser.scan_workflow_escalations');
      const rows = await escalationRateModule.run(tx, subaccountId);
      logger.info('optimiser.scan.completed', { scanCategory: escalationRateModule.category, resultCount: rows.length, subaccountId });
      const outputs = evaluate(rows, { subaccountId, organisationId: context.organisationId, medianVersion: 0, priorRecsByDedupe: new Map() });
      return { success: true, outputs };
    } catch (err) {
      logger.error('optimiser.scan.failed', { scanCategory: 'optimiser.playbook.escalation_rate', error: err instanceof Error ? err.message : String(err), subaccountId });
      throw err;
    }
  },

  'optimiser.scan_skill_latency': async (input, context) => {
    const subaccountId = requireSubaccountContext(context, 'optimiser.scan_skill_latency');
    try {
      const { skillLatencyModule, peerMediansViewIsPopulated, runSkillLatencyQuery } = await import('../../optimiser/queries/skillLatency.js');
      const { evaluateSkillSlow } = await import('../../optimiser/recommendations/skillSlow.js');
      const populated = await peerMediansViewIsPopulated();
      if (!populated) {
        logger.info('optimiser.scan.partial', { scanCategory: skillLatencyModule.category, medianVersion: 0, subaccountId });
        return { success: true, outputs: [] };
      }
      const { withAdminConnectionGuarded: adminGuarded } = await import('../../../lib/rlsBoundaryGuard.js');
      let outputs: import('../../optimiser/recommendations/types.js').EvaluatorOutput[] = [];
      await adminGuarded(
        { source: 'optimiser.scan_skill_latency', allowRlsBypass: false },
        async (adminTx) => {
          const versionRows = await adminTx.execute<{ max_version: number }>(
            (await import('drizzle-orm')).sql`SELECT MAX(median_version) AS max_version FROM optimiser_skill_peer_medians`,
          );
          const medianVersion = versionRows[0]?.max_version ?? 0;
          const rows = await runSkillLatencyQuery(adminTx, subaccountId, medianVersion);
          logger.info('optimiser.scan.completed', { scanCategory: skillLatencyModule.category, resultCount: rows.length, subaccountId });
          outputs = evaluateSkillSlow(rows, { subaccountId, organisationId: context.organisationId, medianVersion, priorRecsByDedupe: new Map() });
        },
      );
      return { success: true, outputs };
    } catch (err) {
      logger.error('optimiser.scan.failed', { scanCategory: 'optimiser.skill.slow', error: err instanceof Error ? err.message : String(err), subaccountId });
      throw err;
    }
  },

  'optimiser.scan_inactive_workflows': async (input, context) => {
    const subaccountId = requireSubaccountContext(context, 'optimiser.scan_inactive_workflows');
    try {
      const { module: inactiveWorkflowsModule } = await import('../../optimiser/queries/inactiveWorkflows.js');
      const { evaluate } = await import('../../optimiser/recommendations/inactiveWorkflow.js');
      const tx = getOrgScopedDb('optimiser.scan_inactive_workflows');
      const rows = await inactiveWorkflowsModule.run(tx, subaccountId);
      logger.info('optimiser.scan.completed', { scanCategory: inactiveWorkflowsModule.category, resultCount: rows.length, subaccountId });
      const outputs = evaluate(rows, { subaccountId, organisationId: context.organisationId, medianVersion: 0, priorRecsByDedupe: new Map() });
      return { success: true, outputs };
    } catch (err) {
      logger.error('optimiser.scan.failed', { scanCategory: 'optimiser.inactive.workflow', error: err instanceof Error ? err.message : String(err), subaccountId });
      throw err;
    }
  },

  'optimiser.scan_escalation_phrases': async (input, context) => {
    const subaccountId = requireSubaccountContext(context, 'optimiser.scan_escalation_phrases');
    try {
      const { module: escalationPhrasesModule } = await import('../../optimiser/queries/escalationPhrases.js');
      const { evaluate } = await import('../../optimiser/recommendations/repeatPhrase.js');
      const tx = getOrgScopedDb('optimiser.scan_escalation_phrases');
      const rows = await escalationPhrasesModule.run(tx, subaccountId);
      logger.info('optimiser.scan.completed', { scanCategory: escalationPhrasesModule.category, resultCount: rows.length, subaccountId });
      const outputs = evaluate(rows, { subaccountId, organisationId: context.organisationId, medianVersion: 0, priorRecsByDedupe: new Map() });
      return { success: true, outputs };
    } catch (err) {
      logger.error('optimiser.scan.failed', { scanCategory: 'optimiser.escalation.repeat_phrase', error: err instanceof Error ? err.message : String(err), subaccountId });
      throw err;
    }
  },

  'optimiser.scan_memory_citation': async (input, context) => {
    const subaccountId = requireSubaccountContext(context, 'optimiser.scan_memory_citation');
    try {
      const { module: memoryCitationModule } = await import('../../optimiser/queries/memoryCitation.js');
      const { evaluate } = await import('../../optimiser/recommendations/memoryCitation.js');
      const tx = getOrgScopedDb('optimiser.scan_memory_citation');
      const rows = await memoryCitationModule.run(tx, subaccountId);
      logger.info('optimiser.scan.completed', { scanCategory: memoryCitationModule.category, resultCount: rows.length, subaccountId });
      const outputs = evaluate(rows, { subaccountId, organisationId: context.organisationId, medianVersion: 0, priorRecsByDedupe: new Map() });
      return { success: true, outputs };
    } catch (err) {
      logger.error('optimiser.scan.failed', { scanCategory: 'optimiser.memory.low_citation_waste', error: err instanceof Error ? err.message : String(err), subaccountId });
      throw err;
    }
  },

  'optimiser.scan_routing_uncertainty': async (input, context) => {
    const subaccountId = requireSubaccountContext(context, 'optimiser.scan_routing_uncertainty');
    try {
      const { module: routingUncertaintyModule } = await import('../../optimiser/queries/routingUncertainty.js');
      const { evaluate } = await import('../../optimiser/recommendations/routingUncertainty.js');
      const tx = getOrgScopedDb('optimiser.scan_routing_uncertainty');
      const rows = await routingUncertaintyModule.run(tx, subaccountId);
      logger.info('optimiser.scan.completed', { scanCategory: routingUncertaintyModule.category, resultCount: rows.length, subaccountId });
      const outputs = evaluate(rows, { subaccountId, organisationId: context.organisationId, medianVersion: 0, priorRecsByDedupe: new Map() });
      return { success: true, outputs };
    } catch (err) {
      logger.error('optimiser.scan.failed', { scanCategory: 'optimiser.agent.routing_uncertainty', error: err instanceof Error ? err.message : String(err), subaccountId });
      throw err;
    }
  },

  'optimiser.scan_cache_efficiency': async (input, context) => {
    const subaccountId = requireSubaccountContext(context, 'optimiser.scan_cache_efficiency');
    try {
      const { module: cacheEfficiencyModule } = await import('../../optimiser/queries/cacheEfficiency.js');
      const { evaluate } = await import('../../optimiser/recommendations/cacheEfficiency.js');
      const tx = getOrgScopedDb('optimiser.scan_cache_efficiency');
      const rows = await cacheEfficiencyModule.run(tx, subaccountId);
      logger.info('optimiser.scan.completed', { scanCategory: cacheEfficiencyModule.category, resultCount: rows.length, subaccountId });
      const outputs = evaluate(rows, { subaccountId, organisationId: context.organisationId, medianVersion: 0, priorRecsByDedupe: new Map() });
      return { success: true, outputs };
    } catch (err) {
      logger.error('optimiser.scan.failed', { scanCategory: 'optimiser.llm.cache_poor_reuse', error: err instanceof Error ? err.message : String(err), subaccountId });
      throw err;
    }
  },
};
