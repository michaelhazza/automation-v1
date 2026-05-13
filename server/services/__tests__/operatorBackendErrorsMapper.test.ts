import { describe, it, expect } from 'vitest';
import {
  mapOperatorBackendErrorToHttp,
  OperatorBackendConflictError,
  OperatorSessionLimitExceededError,
} from '../operatorBackendErrors.js';

describe('mapOperatorBackendErrorToHttp', () => {
  describe('OperatorBackendConflictError', () => {
    it('maps TASK_ALREADY_TERMINAL to 409 with kind and current_state', () => {
      const err = new OperatorBackendConflictError({
        kind: 'TASK_ALREADY_TERMINAL',
        currentState: { status: 'completed' },
      });

      const result = mapOperatorBackendErrorToHttp(err);

      expect(result).not.toBeNull();
      expect(result!.statusCode).toBe(409);
      expect(result!.errorCode).toBe('operator_backend_conflict');
      expect(result!.body.kind).toBe('TASK_ALREADY_TERMINAL');
      expect(result!.body.current_state).toEqual({ status: 'completed' });
    });

    it('maps OPERATOR_TASK_RESTART_BLOCKED to 409', () => {
      const err = new OperatorBackendConflictError({
        kind: 'OPERATOR_TASK_RESTART_BLOCKED',
        currentState: { status: 'running' },
      });

      const result = mapOperatorBackendErrorToHttp(err);

      expect(result).not.toBeNull();
      expect(result!.statusCode).toBe(409);
      expect(result!.body.kind).toBe('OPERATOR_TASK_RESTART_BLOCKED');
    });

    it('maps OPERATOR_SETTINGS_CONFLICT to 409', () => {
      const err = new OperatorBackendConflictError({
        kind: 'OPERATOR_SETTINGS_CONFLICT',
        currentState: { settings_version: 3 },
      });

      const result = mapOperatorBackendErrorToHttp(err);

      expect(result).not.toBeNull();
      expect(result!.statusCode).toBe(409);
      expect(result!.body.kind).toBe('OPERATOR_SETTINGS_CONFLICT');
      expect(result!.body.current_state).toEqual({ settings_version: 3 });
    });
  });

  describe('OperatorSessionLimitExceededError', () => {
    it('maps to 429 with cap, current, and subaccount_id', () => {
      const err = new OperatorSessionLimitExceededError({
        cap: 5,
        current: 5,
        subaccountId: 'sub-123',
      });

      const result = mapOperatorBackendErrorToHttp(err);

      expect(result).not.toBeNull();
      expect(result!.statusCode).toBe(429);
      expect(result!.errorCode).toBe('operator_session_limit_exceeded');
      expect(result!.body.cap).toBe(5);
      expect(result!.body.current).toBe(5);
      expect(result!.body.subaccount_id).toBe('sub-123');
    });
  });

  describe('unknown errors', () => {
    it('returns null for a generic Error', () => {
      const result = mapOperatorBackendErrorToHttp(new Error('generic'));
      expect(result).toBeNull();
    });

    it('returns null for a plain object', () => {
      const result = mapOperatorBackendErrorToHttp({ statusCode: 409 });
      expect(result).toBeNull();
    });

    it('returns null for null', () => {
      const result = mapOperatorBackendErrorToHttp(null);
      expect(result).toBeNull();
    });

    it('returns null for undefined', () => {
      const result = mapOperatorBackendErrorToHttp(undefined);
      expect(result).toBeNull();
    });
  });
});
