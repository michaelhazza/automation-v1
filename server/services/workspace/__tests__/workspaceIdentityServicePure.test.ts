import { test, expect } from 'vitest';
import { canTransition, nextStatus } from '../workspaceIdentityServicePure.js';

test('valid transitions', () => {
  expect(canTransition('provisioned', 'active')).toBe(true);
  expect(canTransition('active', 'suspended')).toBe(true);
  expect(canTransition('suspended', 'active')).toBe(true);
  expect(canTransition('active', 'revoked')).toBe(true);
  expect(canTransition('suspended', 'revoked')).toBe(true);
  expect(canTransition('active', 'archived')).toBe(true);
  expect(canTransition('revoked', 'archived')).toBe(true);
});

test('forbidden transitions', () => {
  expect(canTransition('provisioned', 'suspended')).toBe(false);
  expect(canTransition('revoked', 'active')).toBe(false);
  expect(canTransition('archived', 'active')).toBe(false);
  expect(canTransition('archived', 'revoked')).toBe(false);
});

test('nextStatus enforces the rules', () => {
  expect(nextStatus('provisioned', 'activate')).toBe('active');
  expect(() => nextStatus('provisioned', 'suspend')).toThrow();
  expect(() => nextStatus('revoked', 'resume')).toThrow();
});
