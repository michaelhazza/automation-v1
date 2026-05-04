/**
 * Unit tests for workflowValidatorPure — eight V1 publish-time rules.
 *
 * Spec: tasks/workflows-spec.md §4.1–§4.8 (Chunk 2).
 *
 * Runnable with:
 *   npx vitest run server/services/__tests__/workflowValidatorPure.test.ts
 */

import { describe, expect, test } from 'vitest';
import { validate } from '../workflowValidatorPure.js';
import type { WorkflowDefinition, WorkflowStepDefinition } from '../workflowValidatorPure.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeStep(
  overrides: Partial<WorkflowStepDefinition> & { id: string; type: string }
): WorkflowStepDefinition {
  return { dependsOn: [], ...overrides };
}

function makeDef(steps: WorkflowStepDefinition[]): WorkflowDefinition {
  return { steps };
}

// ─── Rule 1: four_as_vocabulary ───────────────────────────────────────────────

describe('Rule 1: four_as_vocabulary', () => {
  test('all four V1 types pass with acceptLegacyTypes: false', () => {
    const result = validate(
      makeDef([
        makeStep({ id: 's1', type: 'agent' }),
        makeStep({ id: 's2', type: 'action', dependsOn: ['s1'] }),
        makeStep({ id: 's3', type: 'approval', dependsOn: ['s2'] }),
        makeStep({ id: 's4', type: 'ask', dependsOn: ['s3'] }),
      ]),
      { acceptLegacyTypes: false }
    );
    expect(result.ok).toBe(true);
  });

  test('legacy agent_call rejected when acceptLegacyTypes: false', () => {
    const result = validate(
      makeDef([makeStep({ id: 's1', type: 'agent_call' })]),
      { acceptLegacyTypes: false }
    );
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.rule === 'four_as_vocabulary' && e.stepId === 's1')).toBe(true);
  });

  test('legacy action_call rejected when acceptLegacyTypes: false', () => {
    const result = validate(
      makeDef([makeStep({ id: 's1', type: 'action_call' })]),
      { acceptLegacyTypes: false }
    );
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.rule === 'four_as_vocabulary' && e.stepId === 's1')).toBe(true);
  });

  test('legacy user_input rejected when acceptLegacyTypes: false', () => {
    const result = validate(
      makeDef([makeStep({ id: 's1', type: 'user_input' })]),
      { acceptLegacyTypes: false }
    );
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.rule === 'four_as_vocabulary' && e.stepId === 's1')).toBe(true);
  });

  test('legacy agent_call accepted when acceptLegacyTypes: true', () => {
    const result = validate(
      makeDef([makeStep({ id: 's1', type: 'agent_call' })]),
      { acceptLegacyTypes: true }
    );
    expect(result.ok).toBe(true);
  });

  test('legacy action_call accepted when acceptLegacyTypes: true', () => {
    const result = validate(
      makeDef([makeStep({ id: 's1', type: 'action_call' })]),
      { acceptLegacyTypes: true }
    );
    expect(result.ok).toBe(true);
  });

  test('legacy user_input accepted when acceptLegacyTypes: true', () => {
    const result = validate(
      makeDef([makeStep({ id: 's1', type: 'user_input' })]),
      { acceptLegacyTypes: true }
    );
    expect(result.ok).toBe(true);
  });

  test('all legacy engine types accepted when acceptLegacyTypes: true', () => {
    const result = validate(
      makeDef([
        makeStep({ id: 's1', type: 'agent_call' }),
        makeStep({ id: 's2', type: 'action_call', dependsOn: ['s1'] }),
        makeStep({ id: 's3', type: 'user_input', dependsOn: ['s2'] }),
        makeStep({ id: 's4', type: 'prompt', dependsOn: ['s3'] }),
        makeStep({ id: 's5', type: 'conditional', dependsOn: ['s4'] }),
        makeStep({ id: 's6', type: 'agent_decision', dependsOn: ['s5'] }),
        makeStep({ id: 's7', type: 'invoke_automation', dependsOn: ['s6'] }),
      ]),
      { acceptLegacyTypes: true }
    );
    expect(result.ok).toBe(true);
  });

  test('completely unknown type rejected regardless of acceptLegacyTypes', () => {
    const result = validate(
      makeDef([makeStep({ id: 's1', type: 'unknown_type' })]),
      { acceptLegacyTypes: true }
    );
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.rule === 'four_as_vocabulary')).toBe(true);
  });
});

// ─── Rule 2: branching_target_exists ─────────────────────────────────────────

describe('Rule 2: branching_target_exists', () => {
  test('nonexistent onSuccess target is an error', () => {
    const result = validate(
      makeDef([makeStep({ id: 's1', type: 'agent', onSuccess: 'nonexistent' })]),
      {}
    );
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.rule === 'branching_target_exists' && e.stepId === 's1')).toBe(true);
  });

  test('nonexistent onFail target is an error', () => {
    const result = validate(
      makeDef([makeStep({ id: 's1', type: 'agent', onFail: 'ghost' })]),
      {}
    );
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.rule === 'branching_target_exists' && e.stepId === 's1')).toBe(true);
  });

  test('nonexistent onReject target is an error', () => {
    const result = validate(
      makeDef([makeStep({ id: 's1', type: 'approval', onReject: 'ghost' })]),
      {}
    );
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.rule === 'branching_target_exists' && e.stepId === 's1')).toBe(true);
  });

  test('nonexistent dependsOn reference is an error', () => {
    const result = validate(
      makeDef([makeStep({ id: 's1', type: 'agent', dependsOn: ['missing'] })]),
      {}
    );
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.rule === 'branching_target_exists' && e.stepId === 's1')).toBe(true);
  });

  test('valid multi-target onSuccess passes', () => {
    const result = validate(
      makeDef([
        makeStep({ id: 's1', type: 'agent', onSuccess: ['s2', 's3'] }),
        makeStep({ id: 's2', type: 'action', dependsOn: ['s1'] }),
        makeStep({ id: 's3', type: 'approval', dependsOn: ['s1'] }),
      ]),
      {}
    );
    // May or may not pass depending on other rules; just check no branching_target_exists
    expect(result.errors.some((e) => e.rule === 'branching_target_exists')).toBe(false);
  });
});

// ─── Rule 3: parallel_depth ───────────────────────────────────────────────────

describe('Rule 3: parallel_depth', () => {
  test('one level of fan-out is allowed', () => {
    const result = validate(
      makeDef([
        makeStep({ id: 's1', type: 'agent', onSuccess: ['s2', 's3'] }),
        makeStep({ id: 's2', type: 'action', dependsOn: ['s1'] }),
        makeStep({ id: 's3', type: 'action', dependsOn: ['s1'] }),
      ]),
      {}
    );
    expect(result.errors.some((e) => e.rule === 'parallel_depth')).toBe(false);
  });

  test('nested fan-out (fan-out within fan-out) is rejected', () => {
    // s1 fans out to s2, s3; s2 also fans out to s4, s5 → depth violation
    const result = validate(
      makeDef([
        makeStep({ id: 's1', type: 'agent', onSuccess: ['s2', 's3'] }),
        makeStep({ id: 's2', type: 'action', dependsOn: ['s1'], onSuccess: ['s4', 's5'] }),
        makeStep({ id: 's3', type: 'action', dependsOn: ['s1'] }),
        makeStep({ id: 's4', type: 'action', dependsOn: ['s2'] }),
        makeStep({ id: 's5', type: 'action', dependsOn: ['s2'] }),
      ]),
      {}
    );
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.rule === 'parallel_depth' && e.stepId === 's1')).toBe(true);
  });

  test('sequential steps without fan-out are not flagged', () => {
    const result = validate(
      makeDef([
        makeStep({ id: 's1', type: 'agent', onSuccess: 's2' }),
        makeStep({ id: 's2', type: 'action', dependsOn: ['s1'], onSuccess: 's3' }),
        makeStep({ id: 's3', type: 'approval', dependsOn: ['s2'] }),
      ]),
      {}
    );
    expect(result.errors.some((e) => e.rule === 'parallel_depth')).toBe(false);
  });
});

// ─── Rule 4: loop_only_on_approval_reject ─────────────────────────────────────

describe('Rule 4: loop_only_on_approval_reject', () => {
  test('backward onReject edge on approval step is allowed', () => {
    const result = validate(
      makeDef([
        makeStep({ id: 's1', type: 'agent' }),
        makeStep({ id: 's2', type: 'approval', dependsOn: ['s1'], onReject: 's1' }),
      ]),
      {}
    );
    expect(result.errors.some((e) => e.rule === 'loop_only_on_approval_reject')).toBe(false);
  });

  test('backward onReject edge on non-approval step is rejected', () => {
    const result = validate(
      makeDef([
        makeStep({ id: 's1', type: 'agent' }),
        makeStep({ id: 's2', type: 'action', dependsOn: ['s1'], onReject: 's1' }),
      ]),
      {}
    );
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.rule === 'loop_only_on_approval_reject' && e.stepId === 's2')).toBe(true);
  });

  test('backward onFail edge on non-approval step is rejected', () => {
    const result = validate(
      makeDef([
        makeStep({ id: 's1', type: 'agent' }),
        makeStep({ id: 's2', type: 'action', dependsOn: ['s1'], onFail: 's1' }),
      ]),
      {}
    );
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.rule === 'loop_only_on_approval_reject' && e.stepId === 's2')).toBe(true);
  });

  test('backward onFail edge on approval step is rejected (onFail is not a loop primitive)', () => {
    const result = validate(
      makeDef([
        makeStep({ id: 's1', type: 'agent' }),
        makeStep({ id: 's2', type: 'approval', dependsOn: ['s1'], onFail: 's1' }),
      ]),
      {}
    );
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.rule === 'loop_only_on_approval_reject' && e.stepId === 's2')).toBe(true);
  });

  test('backward onReject edge on user_input (legacy approval) is allowed', () => {
    const result = validate(
      makeDef([
        makeStep({ id: 's1', type: 'agent' }),
        makeStep({ id: 's2', type: 'user_input', dependsOn: ['s1'], onReject: 's1' }),
      ]),
      { acceptLegacyTypes: true }
    );
    expect(result.errors.some((e) => e.rule === 'loop_only_on_approval_reject')).toBe(false);
  });

  test('forward onReject edge on non-approval step is NOT flagged', () => {
    // forward edge — s1 onReject → s2; s2 is after s1 in the definition
    const result = validate(
      makeDef([
        makeStep({ id: 's1', type: 'agent', onReject: 's2' }),
        makeStep({ id: 's2', type: 'action', dependsOn: ['s1'] }),
      ]),
      {}
    );
    expect(result.errors.some((e) => e.rule === 'loop_only_on_approval_reject')).toBe(false);
  });
});

// ─── Rule 5: no_workflow_to_workflow ─────────────────────────────────────────

describe('Rule 5: no_workflow_to_workflow', () => {
  test('step type containing "workflow" is rejected', () => {
    const result = validate(
      makeDef([makeStep({ id: 's1', type: 'invoke_workflow' })]),
      { acceptLegacyTypes: true }
    );
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.rule === 'no_workflow_to_workflow' && e.stepId === 's1')).toBe(true);
  });

  test('step type "workflow_call" is rejected', () => {
    const result = validate(
      makeDef([makeStep({ id: 's1', type: 'workflow_call' })]),
      { acceptLegacyTypes: true }
    );
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.rule === 'no_workflow_to_workflow')).toBe(true);
  });

  test('standard step types do not trigger no_workflow_to_workflow', () => {
    const result = validate(
      makeDef([
        makeStep({ id: 's1', type: 'agent' }),
        makeStep({ id: 's2', type: 'invoke_automation', dependsOn: ['s1'] }),
      ]),
      {}
    );
    expect(result.errors.some((e) => e.rule === 'no_workflow_to_workflow')).toBe(false);
  });
});

// ─── Rule 6: quorum_specific_users ───────────────────────────────────────────

describe('Rule 6: quorum_specific_users', () => {
  test('specific_users with empty userIds is rejected', () => {
    const result = validate(
      makeDef([
        makeStep({
          id: 's1',
          type: 'approval',
          params: { approverGroup: { kind: 'specific_users', userIds: [] } },
        }),
      ]),
      {}
    );
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.rule === 'quorum_specific_users' && e.stepId === 's1')).toBe(true);
  });

  test('specific_users with quorum > userIds.length is rejected', () => {
    const result = validate(
      makeDef([
        makeStep({
          id: 's1',
          type: 'approval',
          params: {
            approverGroup: { kind: 'specific_users', userIds: ['u1', 'u2'], quorum: 5 },
          },
        }),
      ]),
      {}
    );
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.rule === 'quorum_specific_users' && e.stepId === 's1')).toBe(true);
  });

  test('specific_users with quorum < 1 is rejected', () => {
    const result = validate(
      makeDef([
        makeStep({
          id: 's1',
          type: 'approval',
          params: {
            approverGroup: { kind: 'specific_users', userIds: ['u1', 'u2'], quorum: 0 },
          },
        }),
      ]),
      {}
    );
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.rule === 'quorum_specific_users' && e.stepId === 's1')).toBe(true);
  });

  test('specific_users with valid quorum passes', () => {
    const result = validate(
      makeDef([
        makeStep({
          id: 's1',
          type: 'approval',
          params: {
            approverGroup: { kind: 'specific_users', userIds: ['u1', 'u2', 'u3'], quorum: 2 },
          },
        }),
      ]),
      {}
    );
    expect(result.errors.some((e) => e.rule === 'quorum_specific_users')).toBe(false);
  });

  test('specific_users with quorum equal to userIds.length passes', () => {
    const result = validate(
      makeDef([
        makeStep({
          id: 's1',
          type: 'approval',
          params: {
            approverGroup: { kind: 'specific_users', userIds: ['u1', 'u2'], quorum: 2 },
          },
        }),
      ]),
      {}
    );
    expect(result.errors.some((e) => e.rule === 'quorum_specific_users')).toBe(false);
  });

  test('non-specific_users approverGroup kind is not checked', () => {
    const result = validate(
      makeDef([
        makeStep({
          id: 's1',
          type: 'approval',
          params: { approverGroup: { kind: 'team' } },
        }),
      ]),
      {}
    );
    expect(result.errors.some((e) => e.rule === 'quorum_specific_users')).toBe(false);
  });
});

// ─── Rule 7: is_critical_only_on_agent_action ────────────────────────────────

describe('Rule 7: is_critical_only_on_agent_action', () => {
  test('is_critical: true on agent step is valid', () => {
    const result = validate(
      makeDef([makeStep({ id: 's1', type: 'agent', params: { is_critical: true } })]),
      {}
    );
    expect(result.errors.some((e) => e.rule === 'is_critical_only_on_agent_action')).toBe(false);
  });

  test('is_critical: true on action step is valid', () => {
    const result = validate(
      makeDef([makeStep({ id: 's1', type: 'action', params: { is_critical: true } })]),
      {}
    );
    expect(result.errors.some((e) => e.rule === 'is_critical_only_on_agent_action')).toBe(false);
  });

  test('is_critical: true on agent_call (legacy) is valid', () => {
    const result = validate(
      makeDef([makeStep({ id: 's1', type: 'agent_call', params: { is_critical: true } })]),
      { acceptLegacyTypes: true }
    );
    expect(result.errors.some((e) => e.rule === 'is_critical_only_on_agent_action')).toBe(false);
  });

  test('is_critical: true on invoke_automation is valid', () => {
    const result = validate(
      makeDef([makeStep({ id: 's1', type: 'invoke_automation', params: { is_critical: true } })]),
      { acceptLegacyTypes: true }
    );
    expect(result.errors.some((e) => e.rule === 'is_critical_only_on_agent_action')).toBe(false);
  });

  test('is_critical: true on approval step is rejected', () => {
    const result = validate(
      makeDef([makeStep({ id: 's1', type: 'approval', params: { is_critical: true } })]),
      {}
    );
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.rule === 'is_critical_only_on_agent_action' && e.stepId === 's1')).toBe(true);
  });

  test('is_critical: true on ask step is rejected', () => {
    const result = validate(
      makeDef([makeStep({ id: 's1', type: 'ask', params: { is_critical: true } })]),
      {}
    );
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.rule === 'is_critical_only_on_agent_action' && e.stepId === 's1')).toBe(true);
  });

  test('is_critical: true on user_input (legacy ask) is rejected', () => {
    const result = validate(
      makeDef([makeStep({ id: 's1', type: 'user_input', params: { is_critical: true } })]),
      { acceptLegacyTypes: true }
    );
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.rule === 'is_critical_only_on_agent_action' && e.stepId === 's1')).toBe(true);
  });

  test('is_critical absent on approval step passes', () => {
    const result = validate(
      makeDef([makeStep({ id: 's1', type: 'approval' })]),
      {}
    );
    expect(result.errors.some((e) => e.rule === 'is_critical_only_on_agent_action')).toBe(false);
  });
});

// ─── Rule 8: ask_single_submit ────────────────────────────────────────────────

describe('Rule 8: ask_single_submit', () => {
  test('ask step with submitterGroup.quorum > 1 is rejected', () => {
    const result = validate(
      makeDef([
        makeStep({ id: 's1', type: 'ask', params: { submitterGroup: { quorum: 2 } } }),
      ]),
      {}
    );
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.rule === 'ask_single_submit' && e.stepId === 's1')).toBe(true);
  });

  test('user_input step with submitterGroup.quorum > 1 is rejected', () => {
    const result = validate(
      makeDef([
        makeStep({ id: 's1', type: 'user_input', params: { submitterGroup: { quorum: 3 } } }),
      ]),
      { acceptLegacyTypes: true }
    );
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.rule === 'ask_single_submit' && e.stepId === 's1')).toBe(true);
  });

  test('ask step with submitterGroup.quorum === 1 passes', () => {
    const result = validate(
      makeDef([makeStep({ id: 's1', type: 'ask', params: { submitterGroup: { quorum: 1 } } })]),
      {}
    );
    expect(result.errors.some((e) => e.rule === 'ask_single_submit')).toBe(false);
  });

  test('ask step without submitterGroup passes', () => {
    const result = validate(
      makeDef([makeStep({ id: 's1', type: 'ask' })]),
      {}
    );
    expect(result.errors.some((e) => e.rule === 'ask_single_submit')).toBe(false);
  });

  test('ask step with submitterGroup but no quorum passes', () => {
    const result = validate(
      makeDef([makeStep({ id: 's1', type: 'ask', params: { submitterGroup: {} } })]),
      {}
    );
    expect(result.errors.some((e) => e.rule === 'ask_single_submit')).toBe(false);
  });

  test('non-ask step with submitterGroup.quorum > 1 is not flagged', () => {
    const result = validate(
      makeDef([
        makeStep({ id: 's1', type: 'agent', params: { submitterGroup: { quorum: 5 } } }),
      ]),
      {}
    );
    expect(result.errors.some((e) => e.rule === 'ask_single_submit')).toBe(false);
  });
});

// ─── System templates: must pass with acceptLegacyTypes: true ─────────────────

describe('System templates: validate with acceptLegacyTypes: true', () => {
  // Step arrays extracted from the three system workflow files.
  // These use engine type names (agent_call, action_call, user_input) → legacy mode.

  const eventCreationSteps: WorkflowStepDefinition[] = [
    { id: 'event_basics', type: 'user_input', dependsOn: [] },
    { id: 'positioning', type: 'agent_call', dependsOn: ['event_basics'] },
    { id: 'landing_page_hero', type: 'agent_call', dependsOn: ['positioning'] },
    { id: 'email_announcement', type: 'agent_call', dependsOn: ['positioning'] },
    {
      id: 'content_review',
      type: 'approval',
      dependsOn: ['landing_page_hero', 'email_announcement'],
    },
    {
      id: 'publish_landing_page',
      type: 'agent_call',
      dependsOn: ['content_review', 'landing_page_hero'],
    },
  ];

  const weeklyDigestSteps: WorkflowStepDefinition[] = [
    { id: 'setup_schedule', type: 'action_call', dependsOn: [] },
    { id: 'gather', type: 'action_call', dependsOn: ['setup_schedule'] },
    { id: 'draft', type: 'prompt', dependsOn: ['gather'] },
    { id: 'deliver', type: 'action_call', dependsOn: ['draft'] },
  ];

  const intelligenceBriefingSteps: WorkflowStepDefinition[] = [
    { id: 'setup_schedule', type: 'action_call', dependsOn: [] },
    { id: 'research', type: 'agent_call', dependsOn: ['setup_schedule'] },
    { id: 'draft', type: 'prompt', dependsOn: ['research'] },
    { id: 'publish_portal', type: 'action_call', dependsOn: ['draft'] },
    { id: 'send_email', type: 'action_call', dependsOn: ['draft'] },
  ];

  test('event-creation system template passes with acceptLegacyTypes: true', () => {
    const result = validate({ steps: eventCreationSteps }, { acceptLegacyTypes: true });
    expect(result.ok).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  test('weekly-digest system template passes with acceptLegacyTypes: true', () => {
    const result = validate({ steps: weeklyDigestSteps }, { acceptLegacyTypes: true });
    expect(result.ok).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  test('intelligence-briefing system template passes with acceptLegacyTypes: true', () => {
    const result = validate({ steps: intelligenceBriefingSteps }, { acceptLegacyTypes: true });
    expect(result.ok).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  test('system template steps fail with acceptLegacyTypes: false', () => {
    // At least one error on rule 1 since agent_call is a legacy type
    const result = validate({ steps: eventCreationSteps }, { acceptLegacyTypes: false });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.rule === 'four_as_vocabulary')).toBe(true);
  });
});

// ─── Collect-all behaviour ────────────────────────────────────────────────────

describe('Collect-all error accumulation', () => {
  test('multiple violations all appear in errors array', () => {
    const result = validate(
      makeDef([
        // Rule 7: is_critical on approval
        makeStep({ id: 's1', type: 'approval', params: { is_critical: true } }),
        // Rule 8: submitterGroup.quorum > 1 on ask
        makeStep({ id: 's2', type: 'ask', params: { submitterGroup: { quorum: 2 } }, dependsOn: ['s1'] }),
      ]),
      {}
    );
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.rule === 'is_critical_only_on_agent_action')).toBe(true);
    expect(result.errors.some((e) => e.rule === 'ask_single_submit')).toBe(true);
    expect(result.errors.length).toBeGreaterThanOrEqual(2);
  });

  test('empty definition has no errors', () => {
    const result = validate(makeDef([]), {});
    expect(result.ok).toBe(true);
    expect(result.errors).toHaveLength(0);
  });
});
