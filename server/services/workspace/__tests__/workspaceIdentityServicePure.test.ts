import { strict as assert } from 'node:assert';
import { canTransition, nextStatus } from '../workspaceIdentityServicePure.js';

// Valid transitions
assert.equal(canTransition('provisioned', 'active'), true);
assert.equal(canTransition('active', 'suspended'), true);
assert.equal(canTransition('suspended', 'active'), true);
assert.equal(canTransition('active', 'revoked'), true);
assert.equal(canTransition('suspended', 'revoked'), true);
assert.equal(canTransition('active', 'archived'), true);
assert.equal(canTransition('revoked', 'archived'), true);

// Forbidden transitions
assert.equal(canTransition('provisioned', 'suspended'), false, 'must go through active first');
assert.equal(canTransition('revoked', 'active'), false, 'revoked is terminal');
assert.equal(canTransition('archived', 'active'), false, 'archived is terminal');
assert.equal(canTransition('archived', 'revoked'), false);

// nextStatus enforces the rules
assert.equal(nextStatus('provisioned', 'activate'), 'active');
assert.throws(() => nextStatus('provisioned', 'suspend'));
assert.throws(() => nextStatus('revoked', 'resume'));

console.log('workspaceIdentityServicePure.test: OK');
