import { test, expect } from 'vitest';
import { deriveSeatConsumption, countActiveIdentities } from '../seatDerivation.js';

test('provisioned does NOT consume a seat', () => {
  expect(deriveSeatConsumption('provisioned')).toBe(false);
});

test('active consumes a seat', () => {
  expect(deriveSeatConsumption('active')).toBe(true);
});

test('suspended frees the seat', () => {
  expect(deriveSeatConsumption('suspended')).toBe(false);
});

test('revoked frees the seat', () => {
  expect(deriveSeatConsumption('revoked')).toBe(false);
});

test('archived does not consume', () => {
  expect(deriveSeatConsumption('archived')).toBe(false);
});

test('countActiveIdentities counts only active', () => {
  expect(
    countActiveIdentities([
      { status: 'active' },
      { status: 'suspended' },
      { status: 'active' },
      { status: 'revoked' },
      { status: 'provisioned' },
    ]),
  ).toBe(2);
});
