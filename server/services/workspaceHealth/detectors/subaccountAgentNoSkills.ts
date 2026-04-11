/**
 * subaccountAgentNoSkills.ts — Brain Tree OS adoption P4 detector.
 *
 * Triggers a warning when a linked subaccount agent has no skill list AND
 * the parent org agent's defaultSkillSlugs is also empty. The skill cascade
 * resolution would produce an effective empty skill set at run time.
 */

import type { Detector, WorkspaceHealthFinding } from '../detectorTypes';

export const subaccountAgentNoSkills: Detector = (ctx) => {
  const findings: WorkspaceHealthFinding[] = [];
  // Build an O(1) lookup from agentId to defaultSkillSlugs.
  const agentDefaults = new Map<string, string[] | null>();
  for (const a of ctx.agents) agentDefaults.set(a.id, a.defaultSkillSlugs);

  for (const link of ctx.subaccountAgents) {
    const linkSkills = link.skillSlugs;
    if (linkSkills && linkSkills.length > 0) continue;

    const orgDefaults = agentDefaults.get(link.agentId);
    if (orgDefaults && orgDefaults.length > 0) continue;

    findings.push({
      detector: 'subaccount_agent.no_skills',
      severity: 'warning',
      resourceKind: 'subaccount_agent',
      resourceId: link.id,
      resourceLabel: `${link.agentName} @ ${link.subaccountName}`,
      message: 'Linked agent has no skills configured at either tier — runs will execute against an empty tool set.',
      recommendation: 'Open the agent link and assign at least one skill, or set defaultSkillSlugs on the org-level agent.',
    });
  }

  return findings;
};
