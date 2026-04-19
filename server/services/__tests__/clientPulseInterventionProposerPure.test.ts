/**
 * clientPulseInterventionProposerPure.test.ts — scenario-detector matcher.
 *
 * Runnable via:
 *   npx tsx server/services/__tests__/clientPulseInterventionProposerPure.test.ts
 */

import {
  proposeClientPulseInterventionsPure,
  type ProposerInputs,
  type ProposerResult,
} from '../clientPulseInterventionProposerPure.js';
import type { InterventionType } from '../orgConfigService.js';

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  PASS  ${name}`);
  } catch (err) {
    failed++;
    console.log(`  FAIL  ${name}`);
    console.log(`        ${err instanceof Error ? err.message : err}`);
  }
}

function assert(condition: boolean, label: string) {
  if (!condition) throw new Error(label);
}

const baseTemplate: InterventionType = {
  slug: 'check_in',
  label: 'Check-in email',
  gateLevel: 'review',
  action: 'send_email',
  actionType: 'crm.send_email',
  targets: ['atRisk', 'watch'],
  priority: 10,
  measurementWindowHours: 24,
  defaultReason: 'scenario_detector:at_risk_check_in',
};

const criticalTemplate: InterventionType = {
  slug: 'escalation_call',
  label: 'Escalation call task',
  gateLevel: 'review',
  action: 'create_task',
  actionType: 'crm.create_task',
  targets: ['critical'],
  priority: 20,
  defaultReason: 'scenario_detector:critical_escalation',
};

const alertTemplate: InterventionType = {
  slug: 'ops_alert',
  label: 'Operator alert',
  gateLevel: 'review',
  action: 'internal_notification',
  actionType: 'clientpulse.operator_alert',
  targets: ['atRisk'],
  priority: 5,
  defaultReason: 'scenario_detector:operator_ping',
};

function baseInputs(overrides: Partial<ProposerInputs> = {}): ProposerInputs {
  return {
    templates: [baseTemplate],
    snapshot: { healthScore: 40, band: 'atRisk', configVersion: 'cv-1' },
    cooldownState: { perTemplate: {} },
    quotaState: {
      dayCountPerSubaccount: 0,
      dayCountPerOrg: 0,
      maxPerSubaccount: 1,
      maxPerOrg: 20,
    },
    ...overrides,
  };
}

// ── Happy path ────────────────────────────────────────────────────────────

test('1. happy path — at_risk band + matching template + no cooldown → 1 proposal', () => {
  const r = proposeClientPulseInterventionsPure(baseInputs());
  assert(r.proposals.length === 1, `proposals=${r.proposals.length}`);
  assert(r.proposals[0].templateSlug === 'check_in', 'slug');
  assert(r.proposals[0].actionType === 'crm.send_email', 'actionType');
  assert(r.suppressed.length === 0, 'no suppressed');
});

// ── No matching template ──────────────────────────────────────────────────

test('2. no matching template → 0 proposals', () => {
  const r = proposeClientPulseInterventionsPure(
    baseInputs({ templates: [criticalTemplate] }),
  );
  assert(r.proposals.length === 0, 'no proposals');
  assert(r.suppressed.length === 1, 'one suppressed');
  assert(r.suppressed[0].reason.startsWith('band_mismatch'), 'band_mismatch reason');
});

// ── Cooldown blocks executed scope ────────────────────────────────────────

test('3. cooldown blocks (executed scope) → 0 proposals', () => {
  const r = proposeClientPulseInterventionsPure(
    baseInputs({
      cooldownState: {
        perTemplate: { check_in: { allowed: false, reason: 'cooldown:executed' } },
      },
    }),
  );
  assert(r.proposals.length === 0, 'no proposals');
  assert(r.suppressed[0].reason === 'cooldown:executed', 'cooldown reason');
});

// ── Cooldown blocks proposed scope ────────────────────────────────────────

test('4. cooldown blocks (proposed scope) → 0 proposals', () => {
  const r = proposeClientPulseInterventionsPure(
    baseInputs({
      cooldownState: {
        perTemplate: { check_in: { allowed: false, reason: 'cooldown:proposed' } },
      },
    }),
  );
  assert(r.proposals.length === 0, 'no proposals');
  assert(r.suppressed[0].reason === 'cooldown:proposed', 'cooldown:proposed reason');
});

// ── Per-subaccount quota ──────────────────────────────────────────────────

test('5. per-subaccount quota exceeded → 0 proposals', () => {
  const r = proposeClientPulseInterventionsPure(
    baseInputs({
      quotaState: {
        dayCountPerSubaccount: 1,
        dayCountPerOrg: 0,
        maxPerSubaccount: 1,
        maxPerOrg: 20,
      },
    }),
  );
  assert(r.proposals.length === 0, 'no proposals');
  assert(r.suppressed[0].reason === 'quota_exceeded:subaccount_day', 'subaccount quota reason');
});

// ── Per-org quota ─────────────────────────────────────────────────────────

test('6. per-org quota exceeded → 0 proposals', () => {
  const r = proposeClientPulseInterventionsPure(
    baseInputs({
      quotaState: {
        dayCountPerSubaccount: 0,
        dayCountPerOrg: 20,
        maxPerSubaccount: 1,
        maxPerOrg: 20,
      },
    }),
  );
  assert(r.proposals.length === 0, 'no proposals');
  assert(r.suppressed[0].reason === 'quota_exceeded:org_day', 'org quota reason');
});

// ── Multi-template priority sort + quota slicing ──────────────────────────

test('7. multi-template + quota=1 → highest-priority wins; rest suppressed as quota', () => {
  const r = proposeClientPulseInterventionsPure(
    baseInputs({
      templates: [baseTemplate, alertTemplate], // both target atRisk; priority 10 vs 5
      quotaState: {
        dayCountPerSubaccount: 0,
        dayCountPerOrg: 0,
        maxPerSubaccount: 1,
        maxPerOrg: 20,
      },
    }),
  );
  assert(r.proposals.length === 1, 'exactly 1 proposal');
  assert(r.proposals[0].templateSlug === 'check_in', 'higher-priority wins');
  assert(r.suppressed.length === 1, '1 suppressed');
  assert(r.suppressed[0].reason === 'quota_exceeded:subaccount_day', 'suppressed reason');
});

// ── Healthy band → 0 proposals ────────────────────────────────────────────

test('8. healthy band → 0 proposals', () => {
  const r = proposeClientPulseInterventionsPure(
    baseInputs({
      snapshot: { healthScore: 90, band: 'healthy', configVersion: 'cv-1' },
    }),
  );
  assert(r.proposals.length === 0, 'no proposals');
  assert(r.suppressed.length === 1, '1 suppressed');
  assert(r.suppressed[0].reason.startsWith('band_mismatch'), 'band_mismatch');
});

// ── Critical band prefers critical template ───────────────────────────────

test('9. critical band picks critical template when both available', () => {
  const r = proposeClientPulseInterventionsPure(
    baseInputs({
      templates: [baseTemplate, criticalTemplate],
      snapshot: { healthScore: 12, band: 'critical', configVersion: 'cv-1' },
    }),
  );
  // baseTemplate targets [atRisk, watch] → band_mismatch
  // criticalTemplate targets [critical] + priority 20 → wins
  assert(r.proposals.length === 1, `proposals=${r.proposals.length}`);
  assert(r.proposals[0].templateSlug === 'escalation_call', `slug=${r.proposals[0].templateSlug}`);
});

// ── Template targeting wrong band ─────────────────────────────────────────

test('10. template targets wrong band → suppressed', () => {
  const r = proposeClientPulseInterventionsPure(
    baseInputs({
      templates: [{ ...baseTemplate, targets: ['watch'] }],
    }),
  );
  assert(r.proposals.length === 0, 'no proposals');
  assert(r.suppressed[0].reason === 'band_mismatch:atRisk', 'reason');
});

// ── Account override ──────────────────────────────────────────────────────

test('11. account override suppressAlerts=true → all suppressed, 0 proposals', () => {
  const r = proposeClientPulseInterventionsPure(
    baseInputs({
      templates: [baseTemplate, alertTemplate],
      accountOverride: { suppressAlerts: true },
    }),
  );
  assert(r.proposals.length === 0, 'no proposals');
  assert(r.suppressed.length === 2, '2 suppressed');
  for (const s of r.suppressed) {
    assert(s.reason === 'account_override:suppress_alerts', 'reason');
  }
});

// ── Template without actionType ───────────────────────────────────────────

test('12. template missing actionType → suppressed', () => {
  const r = proposeClientPulseInterventionsPure(
    baseInputs({
      templates: [{ ...baseTemplate, actionType: undefined }],
    }),
  );
  assert(r.proposals.length === 0, 'no proposals');
  assert(r.suppressed[0].reason === 'template_missing_action_type', 'reason');
});

// ── Empty template catalogue ──────────────────────────────────────────────

test('13. empty templates array → 0 proposals, 0 suppressed', () => {
  const r = proposeClientPulseInterventionsPure(baseInputs({ templates: [] }));
  assert(r.proposals.length === 0, 'no proposals');
  assert(r.suppressed.length === 0, 'no suppressed');
});

// ── Template with no targets (fires on any band) ──────────────────────────

test('14. template with undefined targets fires on any band', () => {
  const r = proposeClientPulseInterventionsPure(
    baseInputs({
      templates: [{ ...baseTemplate, targets: undefined }],
      snapshot: { healthScore: 90, band: 'healthy', configVersion: 'cv-1' },
    }),
  );
  assert(r.proposals.length === 1, 'fires on healthy');
});

// ── Summary ───────────────────────────────────────────────────────────────

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
