/**
 * Unit tests for workflowValidatorPure.
 * Run with: npx tsx server/services/__tests__/workflowValidatorPure.test.ts
 */

import { validate } from '../workflowValidatorPure.js';
import type { WorkflowDefinition, WorkflowStepDefinition } from '../workflowValidatorPure.js';

// ─── Test helpers ─────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function assert(label: string, condition: boolean, detail?: string): void {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ ${label}${detail ? `: ${detail}` : ''}`);
    failed++;
  }
}

function assertOk(label: string, result: ReturnType<typeof validate>): void {
  assert(label, result.ok, result.ok ? undefined : `errors: ${JSON.stringify(result.errors)}`);
}

function assertError(
  label: string,
  result: ReturnType<typeof validate>,
  rule: string,
  stepId?: string
): void {
  const found = result.errors.some(
    (e) => e.rule === rule && (stepId === undefined || e.stepId === stepId)
  );
  assert(
    label,
    !result.ok && found,
    !result.ok
      ? `expected rule '${rule}'${stepId ? ` on step '${stepId}'` : ''}, got: ${JSON.stringify(result.errors)}`
      : 'expected failure but got ok:true'
  );
}

// ─── Shared minimal step factory ─────────────────────────────────────────────

function makeStep(
  overrides: Partial<WorkflowStepDefinition> & { id: string; type: string }
): WorkflowStepDefinition {
  return {
    dependsOn: [],
    ...overrides,
  };
}

// ─── Test cases ───────────────────────────────────────────────────────────────

console.log('\nworkflowValidatorPure tests\n');

// 1. Valid definition with four A's types → ok: true
{
  const def: WorkflowDefinition = {
    steps: [
      makeStep({ id: 'step1', type: 'agent' }),
      makeStep({ id: 'step2', type: 'action', dependsOn: ['step1'] }),
      makeStep({ id: 'step3', type: 'approval', dependsOn: ['step2'] }),
      makeStep({ id: 'step4', type: 'ask', dependsOn: ['step3'] }),
    ],
  };
  assertOk('valid four-A types', validate(def, {}));
}

// 2. Legacy type 'agent_call' + acceptLegacyTypes: true → ok: true
{
  const def: WorkflowDefinition = {
    steps: [makeStep({ id: 'step1', type: 'agent_call' })],
  };
  assertOk('legacy agent_call accepted with acceptLegacyTypes', validate(def, { acceptLegacyTypes: true }));
}

// 3. Legacy type 'agent_call' + acceptLegacyTypes: false → error on four_as_vocabulary
{
  const def: WorkflowDefinition = {
    steps: [makeStep({ id: 'step1', type: 'agent_call' })],
  };
  assertError(
    'legacy agent_call rejected without acceptLegacyTypes',
    validate(def, { acceptLegacyTypes: false }),
    'four_as_vocabulary',
    'step1'
  );
}

// 4. Step references non-existent onSuccess target → error on branching_target_exists
{
  const def: WorkflowDefinition = {
    steps: [makeStep({ id: 'step1', type: 'agent', onSuccess: 'nonexistent' })],
  };
  assertError(
    'nonexistent onSuccess target',
    validate(def, {}),
    'branching_target_exists',
    'step1'
  );
}

// 5. onReject backward edge on a non-approval step → error on loop_only_on_approval_reject
{
  const def: WorkflowDefinition = {
    steps: [
      makeStep({ id: 'step1', type: 'agent' }),
      makeStep({ id: 'step2', type: 'action', dependsOn: ['step1'], onReject: 'step1' }),
    ],
  };
  assertError(
    'backward onReject edge on non-approval step',
    validate(def, {}),
    'loop_only_on_approval_reject',
    'step2'
  );
}

// 6. onReject backward edge on an approval step → ok: true (valid loop)
{
  const def: WorkflowDefinition = {
    steps: [
      makeStep({ id: 'step1', type: 'agent' }),
      makeStep({ id: 'step2', type: 'approval', dependsOn: ['step1'], onReject: 'step1' }),
    ],
  };
  assertOk('backward onReject edge allowed on approval step', validate(def, {}));
}

// 7. approverGroup.kind === 'specific_users' with empty userIds → error on quorum_specific_users
{
  const def: WorkflowDefinition = {
    steps: [
      makeStep({
        id: 'step1',
        type: 'approval',
        params: { approverGroup: { kind: 'specific_users', userIds: [] } },
      }),
    ],
  };
  assertError(
    'specific_users approver group with empty userIds',
    validate(def, {}),
    'quorum_specific_users',
    'step1'
  );
}

// 8. params.is_critical: true on an approval step → error on is_critical_only_on_agent_action
{
  const def: WorkflowDefinition = {
    steps: [
      makeStep({
        id: 'step1',
        type: 'approval',
        params: { is_critical: true },
      }),
    ],
  };
  assertError(
    'is_critical on approval step',
    validate(def, {}),
    'is_critical_only_on_agent_action',
    'step1'
  );
}

// 9. params.is_critical: true on an agent step → ok: true
{
  const def: WorkflowDefinition = {
    steps: [
      makeStep({
        id: 'step1',
        type: 'agent',
        params: { is_critical: true },
      }),
    ],
  };
  assertOk('is_critical on agent step is valid', validate(def, {}));
}

// 10. Three system templates — map their steps to WorkflowStepDefinition shape,
//     validate with acceptLegacyTypes: true, expect ok: true.
//
//     We import the workflow files to get their actual step arrays. These files
//     use ZodSchema fields (outputSchema, formSchema) which are stripped here;
//     WorkflowStepDefinition only requires id, type, dependsOn.

{
  // Inline the step data extracted from the three system workflow files.
  // All three use engine type names → acceptLegacyTypes: true required.

  const eventCreationSteps: WorkflowStepDefinition[] = [
    { id: 'event_basics', type: 'user_input', dependsOn: [] },
    { id: 'positioning', type: 'agent_call', dependsOn: ['event_basics'] },
    { id: 'landing_page_hero', type: 'agent_call', dependsOn: ['positioning'] },
    { id: 'email_announcement', type: 'agent_call', dependsOn: ['positioning'] },
    { id: 'content_review', type: 'approval', dependsOn: ['landing_page_hero', 'email_announcement'] },
    { id: 'publish_landing_page', type: 'agent_call', dependsOn: ['content_review', 'landing_page_hero'] },
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

  const systemTemplates: Array<{ name: string; def: WorkflowDefinition }> = [
    { name: 'event-creation', def: { steps: eventCreationSteps } },
    { name: 'weekly-digest', def: { steps: weeklyDigestSteps } },
    { name: 'intelligence-briefing', def: { steps: intelligenceBriefingSteps } },
  ];

  for (const { name, def } of systemTemplates) {
    assertOk(
      `system template '${name}' validates with acceptLegacyTypes: true`,
      validate(def, { acceptLegacyTypes: true })
    );
  }
}

// ─── Summary ──────────────────────────────────────────────────────────────────

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
