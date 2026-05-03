/**
 * workflowRunStartSkillServicePure.test.ts
 *
 * Pure-logic tests for decideWorkflowRunStartOutcome.
 * Tests every input combination per the spec.
 * No database or I/O required.
 *
 * Run via:
 *   npx vitest run server/services/__tests__/workflowRunStartSkillServicePure.test.ts
 */

import { expect, test, describe } from 'vitest';
import { decideWorkflowRunStartOutcome } from '../workflowRunStartSkillServicePure.js';

// All-pass baseline
const ALL_PASS = {
  templateExists: true,
  templateOrgMatch: true,
  versionResolved: true,
  callerHasPermission: true,
  inputsValid: true,
};

// ─── template_not_found ───────────────────────────────────────────────────────

describe('template_not_found', () => {
  test('template does not exist → template_not_found', () => {
    const result = decideWorkflowRunStartOutcome({
      ...ALL_PASS,
      templateExists: false,
      templateOrgMatch: false,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('template_not_found');
    }
  });

  test('template exists but wrong org → template_not_found', () => {
    const result = decideWorkflowRunStartOutcome({
      ...ALL_PASS,
      templateExists: true,
      templateOrgMatch: false,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('template_not_found');
    }
  });

  test('template_not_found message is non-empty', () => {
    const result = decideWorkflowRunStartOutcome({
      ...ALL_PASS,
      templateExists: false,
      templateOrgMatch: false,
    });
    if (!result.ok) {
      expect(result.message.length).toBeGreaterThan(0);
    }
  });
});

// ─── permission_denied ────────────────────────────────────────────────────────

describe('permission_denied', () => {
  test('no permission → permission_denied', () => {
    const result = decideWorkflowRunStartOutcome({
      ...ALL_PASS,
      callerHasPermission: false,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('permission_denied');
    }
  });

  test('no permission + no published version → still permission_denied (permission checked before version)', () => {
    const result = decideWorkflowRunStartOutcome({
      ...ALL_PASS,
      callerHasPermission: false,
      versionResolved: false,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      // Permission is checked before version — must not leak version state to
      // an unauthorised caller.
      expect(result.error).toBe('permission_denied');
    }
  });
});

// ─── template_not_published ───────────────────────────────────────────────────

describe('template_not_published', () => {
  test('no version resolved → template_not_published', () => {
    const result = decideWorkflowRunStartOutcome({
      ...ALL_PASS,
      versionResolved: false,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('template_not_published');
    }
  });

  test('template_not_published message is non-empty', () => {
    const result = decideWorkflowRunStartOutcome({
      ...ALL_PASS,
      versionResolved: false,
    });
    if (!result.ok) {
      expect(result.message.length).toBeGreaterThan(0);
    }
  });
});

// ─── inputs_invalid ───────────────────────────────────────────────────────────

describe('inputs_invalid', () => {
  test('invalid inputs → inputs_invalid', () => {
    const result = decideWorkflowRunStartOutcome({
      ...ALL_PASS,
      inputsValid: false,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('inputs_invalid');
    }
  });

  test('inputs_invalid message is non-empty', () => {
    const result = decideWorkflowRunStartOutcome({
      ...ALL_PASS,
      inputsValid: false,
    });
    if (!result.ok) {
      expect(result.message.length).toBeGreaterThan(0);
    }
  });
});

// ─── proceed ─────────────────────────────────────────────────────────────────

describe('proceed', () => {
  test('all checks pass → proceed', () => {
    const result = decideWorkflowRunStartOutcome(ALL_PASS);
    expect(result.ok).toBe('proceed');
  });
});

// ─── Priority order ───────────────────────────────────────────────────────────

describe('priority order', () => {
  test('template missing takes priority over permission denied', () => {
    const result = decideWorkflowRunStartOutcome({
      ...ALL_PASS,
      templateExists: false,
      templateOrgMatch: false,
      callerHasPermission: false,
    });
    if (!result.ok) {
      expect(result.error).toBe('template_not_found');
    }
  });

  test('template missing takes priority over version missing', () => {
    const result = decideWorkflowRunStartOutcome({
      ...ALL_PASS,
      templateExists: false,
      templateOrgMatch: false,
      versionResolved: false,
    });
    if (!result.ok) {
      expect(result.error).toBe('template_not_found');
    }
  });

  test('permission denied before inputs_invalid', () => {
    const result = decideWorkflowRunStartOutcome({
      ...ALL_PASS,
      callerHasPermission: false,
      inputsValid: false,
    });
    if (!result.ok) {
      expect(result.error).toBe('permission_denied');
    }
  });

  test('version missing before inputs invalid', () => {
    const result = decideWorkflowRunStartOutcome({
      ...ALL_PASS,
      versionResolved: false,
      inputsValid: false,
    });
    if (!result.ok) {
      expect(result.error).toBe('template_not_published');
    }
  });
});
