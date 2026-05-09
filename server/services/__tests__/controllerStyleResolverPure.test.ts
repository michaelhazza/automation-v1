import { expect, test, describe } from 'vitest';
import {
  deriveControllerStyle,
  ControllerStyleNotAllowedForAgentError,
} from '../controllerStyleResolver.js';

// ── 5 execution modes under test ───────────────────────────────────────────
// operator modes: iee_browser, iee_dev → default 'operator'
// native modes:   api, headless, claude-code → default 'native'
//
// Source vocabulary is locked (spec §4.4.4 line 1018):
//   { 'override' | 'execution_mode_default' | 'subaccount_constraint' }
// controllerStyleAllowed values are locked (spec §3.5):
//   { 'native_only' | 'native_and_operator' }

describe('deriveControllerStyle — no override, native_and_operator', () => {
  test('api → native (execution_mode_default)', () => {
    const r = deriveControllerStyle('api', 'native_and_operator');
    expect(r.controllerStyle).toBe('native');
    expect(r.source).toBe('execution_mode_default');
  });

  test('headless → native (execution_mode_default)', () => {
    const r = deriveControllerStyle('headless', 'native_and_operator');
    expect(r.controllerStyle).toBe('native');
    expect(r.source).toBe('execution_mode_default');
  });

  test('claude-code → native (execution_mode_default)', () => {
    const r = deriveControllerStyle('claude-code', 'native_and_operator');
    expect(r.controllerStyle).toBe('native');
    expect(r.source).toBe('execution_mode_default');
  });

  test('iee_browser → operator (execution_mode_default)', () => {
    const r = deriveControllerStyle('iee_browser', 'native_and_operator');
    expect(r.controllerStyle).toBe('operator');
    expect(r.source).toBe('execution_mode_default');
  });

  test('iee_dev → operator (execution_mode_default)', () => {
    const r = deriveControllerStyle('iee_dev', 'native_and_operator');
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

  test('iee_browser + native_only → downgraded to native (subaccount_constraint)', () => {
    const r = deriveControllerStyle('iee_browser', 'native_only');
    expect(r.controllerStyle).toBe('native');
    expect(r.source).toBe('subaccount_constraint');
  });

  test('iee_dev + native_only → downgraded to native (subaccount_constraint)', () => {
    const r = deriveControllerStyle('iee_dev', 'native_only');
    expect(r.controllerStyle).toBe('native');
    expect(r.source).toBe('subaccount_constraint');
  });
});

describe('deriveControllerStyle — override native, native_and_operator', () => {
  test('api + override native → native (override)', () => {
    const r = deriveControllerStyle('api', 'native_and_operator', 'native');
    expect(r.controllerStyle).toBe('native');
    expect(r.source).toBe('override');
  });

  test('iee_browser + override native → native (override)', () => {
    const r = deriveControllerStyle('iee_browser', 'native_and_operator', 'native');
    expect(r.controllerStyle).toBe('native');
    expect(r.source).toBe('override');
  });

  test('iee_dev + override native → native (override)', () => {
    const r = deriveControllerStyle('iee_dev', 'native_and_operator', 'native');
    expect(r.controllerStyle).toBe('native');
    expect(r.source).toBe('override');
  });
});

describe('deriveControllerStyle — override native, native_only', () => {
  test('api + override native + native_only → native (override)', () => {
    const r = deriveControllerStyle('api', 'native_only', 'native');
    expect(r.controllerStyle).toBe('native');
    expect(r.source).toBe('override');
  });

  test('iee_browser + override native + native_only → native (override)', () => {
    const r = deriveControllerStyle('iee_browser', 'native_only', 'native');
    expect(r.controllerStyle).toBe('native');
    expect(r.source).toBe('override');
  });
});

describe('deriveControllerStyle — override operator, native_and_operator', () => {
  test('api + override operator → operator (override)', () => {
    const r = deriveControllerStyle('api', 'native_and_operator', 'operator');
    expect(r.controllerStyle).toBe('operator');
    expect(r.source).toBe('override');
  });

  test('headless + override operator → operator (override)', () => {
    const r = deriveControllerStyle('headless', 'native_and_operator', 'operator');
    expect(r.controllerStyle).toBe('operator');
    expect(r.source).toBe('override');
  });

  test('iee_browser + override operator + native_and_operator → operator (override)', () => {
    const r = deriveControllerStyle('iee_browser', 'native_and_operator', 'operator');
    expect(r.controllerStyle).toBe('operator');
    expect(r.source).toBe('override');
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
