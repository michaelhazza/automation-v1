import { describe, it, expect } from 'vitest';
import {
  AUTO_EXTEND_GRACE_MINUTES,
  MAX_CHAIN_LENGTH,
  MAX_WALL_CLOCK_PER_TASK_DAYS,
} from '../operatorSettingsDefaults.js';

describe('operatorSettingsDefaults', () => {
  it('AUTO_EXTEND_GRACE_MINUTES is 30', () => {
    expect(AUTO_EXTEND_GRACE_MINUTES).toBe(30);
  });
  it('MAX_CHAIN_LENGTH is 100', () => {
    expect(MAX_CHAIN_LENGTH).toBe(100);
  });
  it('MAX_WALL_CLOCK_PER_TASK_DAYS is 30', () => {
    expect(MAX_WALL_CLOCK_PER_TASK_DAYS).toBe(30);
  });
});
