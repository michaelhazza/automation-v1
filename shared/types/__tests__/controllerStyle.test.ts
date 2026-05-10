import { describe, it, expect } from 'vitest';
import { CONTROLLER_STYLES } from '../controllerStyle.js';
import type { ControllerStyle, ControllerLimits } from '../controllerStyle.js';

describe('controllerStyle', () => {
  describe('CONTROLLER_STYLES const', () => {
    it('contains exactly the two expected literals', () => {
      expect(CONTROLLER_STYLES).toEqual(['native', 'operator']);
    });

    it('has length 2', () => {
      expect(CONTROLLER_STYLES.length).toBe(2);
    });

    it('includes native', () => {
      expect(CONTROLLER_STYLES).toContain('native');
    });

    it('includes operator', () => {
      expect(CONTROLLER_STYLES).toContain('operator');
    });
  });

  describe('ControllerStyle type exhaustiveness (runtime)', () => {
    it('every member of CONTROLLER_STYLES is a valid ControllerStyle', () => {
      for (const style of CONTROLLER_STYLES) {
        // Type assertion validates that the runtime value satisfies the type
        const typed: ControllerStyle = style;
        expect(typed).toBeTruthy();
      }
    });

    it('runtime check covers both values', () => {
      const native: ControllerStyle = 'native';
      const operator: ControllerStyle = 'operator';
      expect([native, operator]).toEqual(expect.arrayContaining(['native', 'operator']));
    });
  });

  describe('ControllerLimits interface shape', () => {
    it('accepts a valid ControllerLimits object', () => {
      const limits: ControllerLimits = {
        maxLoopIterations: 25,
        defaultTokenBudgetMultiplier: 1.0,
        maxToolCallsPerRun: 20,
        approvalDefault: 'auto',
      };
      expect(limits.maxLoopIterations).toBe(25);
      expect(limits.defaultTokenBudgetMultiplier).toBe(1.0);
      expect(limits.maxToolCallsPerRun).toBe(20);
      expect(limits.approvalDefault).toBe('auto');
    });

    it('accepts review as approvalDefault', () => {
      const limits: ControllerLimits = {
        maxLoopIterations: 100,
        defaultTokenBudgetMultiplier: 2.0,
        maxToolCallsPerRun: 80,
        approvalDefault: 'review',
      };
      expect(limits.approvalDefault).toBe('review');
    });

    it('accepts block as approvalDefault', () => {
      const limits: ControllerLimits = {
        maxLoopIterations: 10,
        defaultTokenBudgetMultiplier: 0.5,
        maxToolCallsPerRun: 5,
        approvalDefault: 'block',
      };
      expect(limits.approvalDefault).toBe('block');
    });
  });
});
