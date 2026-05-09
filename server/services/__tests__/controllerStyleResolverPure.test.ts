import { expect, test, describe } from 'vitest';
import {
  deriveControllerStyle,
  ControllerStyleNotAllowedForAgentError,
} from '../controllerStyleResolver.js';

// ── 5 execution modes under test ───────────────────────────────────────────
// operator modes: iee_browser, iee_dev → default 'operator'
// native modes:   api, headless, claude-code → default 'native'

describe('deriveControllerStyle — no override, operator_allowed', () => {
  test('api → native (execution_mode_default)', () => {
    const r = deriveControllerStyle('api', 'operator_allowed');
    expect(r.controllerStyle).toBe('native');
    expect(r.source).toBe('execution_mode_default');
  });

  test('headless → native (execution_mode_default)', () => {
    const r = deriveControllerStyle('headless', 'operator_allowed');
    expect(r.controllerStyle).toBe('native');
    expect(r.source).toBe('execution_mode_default');
  });

  test('claude-code → native (execution_mode_default)', () => {
    const r = deriveControllerStyle('claude-code', 'operator_allowed');
    expect(r.controllerStyle).toBe('native');
    expect(r.source).toBe('execution_mode_default');
  });

  test('iee_browser → operator (execution_mode_default)', () => {
    const r = deriveControllerStyle('iee_browser', 'operator_allowed');
    expect(r.controllerStyle).toBe('operator');
    expect(r.source).toBe('execution_mode_default');
  });

  test('iee_dev → operator (execution_mode_default)', () => {
    const r = deriveControllerStyle('iee_dev', 'operator_allowed');
    expect(r.controllerStyle).toBe('operator');
    expect(r.source).toBe('execution_mode_default');
  });
});

describe('deriveControllerStyle — no override, native_only', () => {
  test('api → native (execution_mode_default)', () => {
    const r = deriveControllerStyle('api', 'native_only');
    expect(r.controllerStyle).toBe('native');
    expect(r.source).toBe('execution_mode_default');
  });

  test('headless → native (execution_mode_default)', () => {
    const r = deriveControllerStyle('headless', 'native_only');
    expect(r.controllerStyle).toBe('native');
    expect(r.source).toBe('execution_mode_default');
  });

  test('claude-code → native (execution_mode_default)', () => {
    const r = deriveControllerStyle('claude-code', 'native_only');
    expect(r.controllerStyle).toBe('native');
    expect(r.source).toBe('execution_mode_default');
  });

  test('iee_browser + native_only → downgraded to native (subaccount_constraint_downgrade)', () => {
    const r = deriveControllerStyle('iee_browser', 'native_only');
    expect(r.controllerStyle).toBe('native');
    expect(r.source).toBe('subaccount_constraint_downgrade');
  });

  test('iee_dev + native_only → downgraded to native (subaccount_constraint_downgrade)', () => {
    const r = deriveControllerStyle('iee_dev', 'native_only');
    expect(r.controllerStyle).toBe('native');
    expect(r.source).toBe('subaccount_constraint_downgrade');
  });
});

describe('deriveControllerStyle — override native, operator_allowed', () => {
  test('api + override native → native (explicit_override)', () => {
    const r = deriveControllerStyle('api', 'operator_allowed', 'native');
    expect(r.controllerStyle).toBe('native');
    expect(r.source).toBe('explicit_override');
  });

  test('iee_browser + override native → native (explicit_override)', () => {
    const r = deriveControllerStyle('iee_browser', 'operator_allowed', 'native');
    expect(r.controllerStyle).toBe('native');
    expect(r.source).toBe('explicit_override');
  });

  test('iee_dev + override native → native (explicit_override)', () => {
    const r = deriveControllerStyle('iee_dev', 'operator_allowed', 'native');
    expect(r.controllerStyle).toBe('native');
    expect(r.source).toBe('explicit_override');
  });
});

describe('deriveControllerStyle — override native, native_only', () => {
  test('api + override native + native_only → native (explicit_override)', () => {
    const r = deriveControllerStyle('api', 'native_only', 'native');
    expect(r.controllerStyle).toBe('native');
    expect(r.source).toBe('explicit_override');
  });

  test('iee_browser + override native + native_only → native (explicit_override)', () => {
    const r = deriveControllerStyle('iee_browser', 'native_only', 'native');
    expect(r.controllerStyle).toBe('native');
    expect(r.source).toBe('explicit_override');
  });
});

describe('deriveControllerStyle — override operator, operator_allowed', () => {
  test('api + override operator → operator (explicit_override)', () => {
    const r = deriveControllerStyle('api', 'operator_allowed', 'operator');
    expect(r.controllerStyle).toBe('operator');
    expect(r.source).toBe('explicit_override');
  });

  test('headless + override operator → operator (explicit_override)', () => {
    const r = deriveControllerStyle('headless', 'operator_allowed', 'operator');
    expect(r.controllerStyle).toBe('operator');
    expect(r.source).toBe('explicit_override');
  });

  test('iee_browser + override operator + operator_allowed → operator (explicit_override)', () => {
    const r = deriveControllerStyle('iee_browser', 'operator_allowed', 'operator');
    expect(r.controllerStyle).toBe('operator');
    expect(r.source).toBe('explicit_override');
  });
});

describe('deriveControllerStyle — override operator rejected (native_only)', () => {
  test('api + override operator + native_only → throws ControllerStyleNotAllowedForAgentError', () => {
    expect(() =>
      deriveControllerStyle('api', 'native_only', 'operator'),
    ).toThrow(ControllerStyleNotAllowedForAgentError);
  });

  test('thrown error has statusCode 422 and errorCode controller_style_not_allowed_for_agent', () => {
    let caught: unknown;
    try {
      deriveControllerStyle('headless', 'native_only', 'operator');
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ControllerStyleNotAllowedForAgentError);
    const err = caught as ControllerStyleNotAllowedForAgentError;
    expect(err.statusCode).toBe(422);
    expect(err.errorCode).toBe('controller_style_not_allowed_for_agent');
  });

  test('iee_browser + override operator + native_only → throws', () => {
    expect(() =>
      deriveControllerStyle('iee_browser', 'native_only', 'operator'),
    ).toThrow(ControllerStyleNotAllowedForAgentError);
  });
});
