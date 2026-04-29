import { strict as assert } from 'node:assert';
import { deriveSeatConsumption, countActiveIdentities } from './seatDerivation.js';

assert.equal(deriveSeatConsumption('provisioned'), false, 'provisioned must NOT consume a seat');
assert.equal(deriveSeatConsumption('active'), true, 'active consumes a seat');
assert.equal(deriveSeatConsumption('suspended'), false, 'suspended frees the seat');
assert.equal(deriveSeatConsumption('revoked'), false, 'revoked frees the seat');
assert.equal(deriveSeatConsumption('archived'), false, 'archived does not consume');

assert.equal(
  countActiveIdentities([
    { status: 'active' },
    { status: 'suspended' },
    { status: 'active' },
    { status: 'revoked' },
    { status: 'provisioned' },
  ]),
  2,
  'countActiveIdentities counts only active',
);

console.log('seatDerivation.test: OK');
