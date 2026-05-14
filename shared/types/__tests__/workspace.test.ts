import { test, expect } from 'vitest';
import { deriveActorState } from '../workspace.js';

test('empty identities → inactive', () => {
  expect(deriveActorState([])).toBe('inactive');
});

test('all non-active statuses → inactive', () => {
  expect(
    deriveActorState([{ status: 'provisioned' }, { status: 'archived' }]),
  ).toBe('inactive');
});

test('single active → active', () => {
  expect(deriveActorState([{ status: 'active' }])).toBe('active');
});

test('active wins over suspended and revoked', () => {
  expect(
    deriveActorState([{ status: 'active' }, { status: 'suspended' }, { status: 'revoked' }]),
  ).toBe('active');
});

test('single suspended → suspended', () => {
  expect(deriveActorState([{ status: 'suspended' }])).toBe('suspended');
});

test('suspended wins over provisioned', () => {
  expect(
    deriveActorState([{ status: 'suspended' }, { status: 'provisioned' }]),
  ).toBe('suspended');
});
