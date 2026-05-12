/**
 * operatorTasksRouteGuards.test.ts
 *
 * Pure tests for the operator task route actor-rule helper.
 * Spec: docs/superpowers/specs/2026-05-12-operator-backend-spec.md §6.5b
 *
 * Runnable via:
 *   npx vitest run server/routes/__tests__/operatorTasksRouteGuards.test.ts
 */

import { describe, expect, test } from 'vitest';
import { evaluateRouteActorRule } from '../operatorRouteActorRulePure.js';

const ACTOR_ID = 'actor-uuid-1';
const OTHER_ID = 'actor-uuid-2';

describe('evaluateRouteActorRule — manager-or-assigned routes (routeRequiresAdmin=false)', () => {
  test('org_admin is always allowed', () => {
    expect(
      evaluateRouteActorRule({
        actorUserId: ACTOR_ID,
        actorRole: 'org_admin',
        assignedUserId: null,
        routeRequiresAdmin: false,
      }),
    ).toEqual({ allowed: true });
  });

  test('manager is always allowed', () => {
    expect(
      evaluateRouteActorRule({
        actorUserId: ACTOR_ID,
        actorRole: 'manager',
        assignedUserId: null,
        routeRequiresAdmin: false,
      }),
    ).toEqual({ allowed: true });
  });

  test('system_admin is always allowed', () => {
    expect(
      evaluateRouteActorRule({
        actorUserId: ACTOR_ID,
        actorRole: 'system_admin',
        assignedUserId: null,
        routeRequiresAdmin: false,
      }),
    ).toEqual({ allowed: true });
  });

  test('regular user who is the assigned user is allowed', () => {
    expect(
      evaluateRouteActorRule({
        actorUserId: ACTOR_ID,
        actorRole: 'user',
        assignedUserId: ACTOR_ID,
        routeRequiresAdmin: false,
      }),
    ).toEqual({ allowed: true });
  });

  test('regular user who is NOT the assigned user is denied', () => {
    const result = evaluateRouteActorRule({
      actorUserId: ACTOR_ID,
      actorRole: 'user',
      assignedUserId: OTHER_ID,
      routeRequiresAdmin: false,
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('REQUIRES_MANAGER_OR_ASSIGNED_USER');
  });

  test('regular user with null assignedUserId is denied', () => {
    const result = evaluateRouteActorRule({
      actorUserId: ACTOR_ID,
      actorRole: 'user',
      assignedUserId: null,
      routeRequiresAdmin: false,
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('REQUIRES_MANAGER_OR_ASSIGNED_USER');
  });

  test('client_user who is not assigned is denied', () => {
    const result = evaluateRouteActorRule({
      actorUserId: ACTOR_ID,
      actorRole: 'client_user',
      assignedUserId: OTHER_ID,
      routeRequiresAdmin: false,
    });
    expect(result.allowed).toBe(false);
  });
});

describe('evaluateRouteActorRule — admin-only routes (routeRequiresAdmin=true)', () => {
  test('org_admin is allowed', () => {
    expect(
      evaluateRouteActorRule({
        actorUserId: ACTOR_ID,
        actorRole: 'org_admin',
        assignedUserId: null,
        routeRequiresAdmin: true,
      }),
    ).toEqual({ allowed: true });
  });

  test('system_admin is allowed', () => {
    expect(
      evaluateRouteActorRule({
        actorUserId: ACTOR_ID,
        actorRole: 'system_admin',
        assignedUserId: null,
        routeRequiresAdmin: true,
      }),
    ).toEqual({ allowed: true });
  });

  test('manager is denied on admin-only route', () => {
    const result = evaluateRouteActorRule({
      actorUserId: ACTOR_ID,
      actorRole: 'manager',
      assignedUserId: null,
      routeRequiresAdmin: true,
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('REQUIRES_ORG_ADMIN');
  });

  test('regular user assigned to the task is still denied on admin-only route', () => {
    const result = evaluateRouteActorRule({
      actorUserId: ACTOR_ID,
      actorRole: 'user',
      assignedUserId: ACTOR_ID,
      routeRequiresAdmin: true,
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('REQUIRES_ORG_ADMIN');
  });
});
