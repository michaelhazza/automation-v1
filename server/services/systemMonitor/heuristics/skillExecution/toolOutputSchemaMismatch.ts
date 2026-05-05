import type { Heuristic, HeuristicContext, Candidate, HeuristicResult, Evidence } from '../types.js';
import type { SkillExecutionEntity } from '../candidateTypes.js';

export const toolOutputSchemaMismatch: Heuristic = {
  id: 'tool-output-schema-mismatch',
  category: 'skill_execution',
  phase: '2.0',
  severity: 'medium',
  confidence: 0.85,
  expectedFpRate: 0.03,
  requiresBaseline: [],
  suppressions: [],
  firesPerEntityPerHour: 2,

  async evaluate(_ctx: HeuristicContext, candidate: Candidate): Promise<HeuristicResult> {
    const exec = candidate.entity as SkillExecutionEntity;

    // If no declared schema, or schema validation passed (sweep handler sets schemaMismatch flag),
    // check if the entity carries a schemaMismatch indicator.
    const entity = candidate.entity as SkillExecutionEntity & { schemaMismatch?: boolean };
    if (!entity.schemaMismatch) return { fired: false };

    const evidence: Evidence = [{
      type: 'tool_output_schema_mismatch',
      ref: exec.executionId,
      summary: `Skill '${exec.skillSlug}' output failed its declared output schema — may indicate API schema drift.`,
    }];
    return { fired: true, evidence, confidence: 0.85 };
  },

  describe(evidence) {
    const ev = evidence[0];
    return ev ? ev.summary : 'Skill output failed its declared schema — possible upstream API change.';
  },
};
