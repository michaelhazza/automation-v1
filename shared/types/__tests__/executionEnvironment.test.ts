import { describe, it, expect } from 'vitest';
import { EXECUTION_ENVIRONMENTS, executionModeToEnvironment } from '../executionEnvironment.js';
import type { ExecutionEnvironment, ExecutionMode } from '../executionEnvironment.js';

describe('executionEnvironment', () => {
  describe('EXECUTION_ENVIRONMENTS const', () => {
    it('contains exactly the four expected literals', () => {
      expect(EXECUTION_ENVIRONMENTS).toEqual(['api_tool', 'headless', 'browser', 'terminal_repo']);
    });

    it('has length 4', () => {
      expect(EXECUTION_ENVIRONMENTS.length).toBe(4);
    });
  });

  describe('ExecutionEnvironment type exhaustiveness (runtime)', () => {
    it('every member is a valid ExecutionEnvironment', () => {
      for (const env of EXECUTION_ENVIRONMENTS) {
        const typed: ExecutionEnvironment = env;
        expect(typed).toBeTruthy();
      }
    });
  });

  describe('executionModeToEnvironment — all five ExecutionMode values', () => {
    it("maps 'api' to 'api_tool'", () => {
      expect(executionModeToEnvironment('api')).toBe('api_tool');
    });

    it("maps 'headless' to 'headless'", () => {
      expect(executionModeToEnvironment('headless')).toBe('headless');
    });

    it("maps 'claude-code' to 'terminal_repo'", () => {
      expect(executionModeToEnvironment('claude-code')).toBe('terminal_repo');
    });

    it("maps 'iee_browser' to 'browser'", () => {
      expect(executionModeToEnvironment('iee_browser')).toBe('browser');
    });

    it("maps 'iee_dev' to 'terminal_repo'", () => {
      expect(executionModeToEnvironment('iee_dev')).toBe('terminal_repo');
    });

    it('returns a value that is in EXECUTION_ENVIRONMENTS for every mode', () => {
      const modes: ExecutionMode[] = ['api', 'headless', 'claude-code', 'iee_browser', 'iee_dev'];
      for (const mode of modes) {
        const env = executionModeToEnvironment(mode);
        expect(EXECUTION_ENVIRONMENTS).toContain(env);
      }
    });
  });

  describe('exhaustiveness guard — compile-time protection verified at runtime', () => {
    it('throws for an unrecognised ExecutionMode value (simulating future enum addition)', () => {
      // Cast to bypass TypeScript's type check to exercise the runtime guard
      const unknown = 'future_mode' as ExecutionMode;
      expect(() => executionModeToEnvironment(unknown)).toThrow(
        'Unhandled ExecutionMode: future_mode',
      );
    });
  });
});
