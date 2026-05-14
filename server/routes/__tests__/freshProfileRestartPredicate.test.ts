/**
 * freshProfileRestartPredicate.test.ts
 *
 * Pure tests for the fresh-profile-restart precondition helper.
 * Spec: docs/superpowers/specs/2026-05-12-operator-backend-spec.md §3.15 item 7, §6.5b (Rev 2 F6)
 *
 * Runnable via:
 *   npx vitest run server/routes/__tests__/freshProfileRestartPredicate.test.ts
 */

import { describe, expect, test } from 'vitest';
import { decideFreshProfileRestartAllowed } from '../../services/freshProfileRestartPredicatePure.js';

describe('decideFreshProfileRestartAllowed', () => {
  test('paused_chain_failure + failure_class profile_corruption → allowed', () => {
    expect(
      decideFreshProfileRestartAllowed({
        taskStatus: 'paused_chain_failure',
        latestChainLinkFailureClass: 'profile_corruption',
        latestChainLinkFailureReason: null,
      }),
    ).toEqual({ allowed: true });
  });

  test('paused_chain_failure + failure_reason OPERATOR_PROFILE_UNRECOVERABLE → allowed', () => {
    expect(
      decideFreshProfileRestartAllowed({
        taskStatus: 'paused_chain_failure',
        latestChainLinkFailureClass: null,
        latestChainLinkFailureReason: 'OPERATOR_PROFILE_UNRECOVERABLE',
      }),
    ).toEqual({ allowed: true });
  });

  test('paused_chain_failure + profile_corruption class AND OPERATOR_PROFILE_UNRECOVERABLE reason → allowed', () => {
    expect(
      decideFreshProfileRestartAllowed({
        taskStatus: 'paused_chain_failure',
        latestChainLinkFailureClass: 'profile_corruption',
        latestChainLinkFailureReason: 'OPERATOR_PROFILE_UNRECOVERABLE',
      }),
    ).toEqual({ allowed: true });
  });

  test('paused_chain_failure + other failure class → blocked LATEST_FAILURE_NOT_PROFILE_CORRUPTION', () => {
    const result = decideFreshProfileRestartAllowed({
      taskStatus: 'paused_chain_failure',
      latestChainLinkFailureClass: 'transient',
      latestChainLinkFailureReason: 'network_timeout',
    });
    expect(result.allowed).toBe(false);
    expect(result.blockingReason).toBe('LATEST_FAILURE_NOT_PROFILE_CORRUPTION');
  });

  test('paused_chain_failure + null failure class and null reason → blocked LATEST_FAILURE_NOT_PROFILE_CORRUPTION', () => {
    const result = decideFreshProfileRestartAllowed({
      taskStatus: 'paused_chain_failure',
      latestChainLinkFailureClass: null,
      latestChainLinkFailureReason: null,
    });
    expect(result.allowed).toBe(false);
    expect(result.blockingReason).toBe('LATEST_FAILURE_NOT_PROFILE_CORRUPTION');
  });

  test('paused_budget_exceeded → blocked TASK_NOT_PAUSED_CHAIN_FAILURE', () => {
    const result = decideFreshProfileRestartAllowed({
      taskStatus: 'paused_budget_exceeded',
      latestChainLinkFailureClass: 'profile_corruption',
      latestChainLinkFailureReason: null,
    });
    expect(result.allowed).toBe(false);
    expect(result.blockingReason).toBe('TASK_NOT_PAUSED_CHAIN_FAILURE');
  });

  test('paused_for_chain_continuation → blocked TASK_NOT_PAUSED_CHAIN_FAILURE', () => {
    const result = decideFreshProfileRestartAllowed({
      taskStatus: 'paused_for_chain_continuation',
      latestChainLinkFailureClass: 'profile_corruption',
      latestChainLinkFailureReason: null,
    });
    expect(result.allowed).toBe(false);
    expect(result.blockingReason).toBe('TASK_NOT_PAUSED_CHAIN_FAILURE');
  });

  test('running task → blocked TASK_NOT_PAUSED_CHAIN_FAILURE', () => {
    const result = decideFreshProfileRestartAllowed({
      taskStatus: 'running',
      latestChainLinkFailureClass: null,
      latestChainLinkFailureReason: null,
    });
    expect(result.allowed).toBe(false);
    expect(result.blockingReason).toBe('TASK_NOT_PAUSED_CHAIN_FAILURE');
  });

  test('completed task → blocked TASK_NOT_PAUSED_CHAIN_FAILURE', () => {
    const result = decideFreshProfileRestartAllowed({
      taskStatus: 'completed',
      latestChainLinkFailureClass: null,
      latestChainLinkFailureReason: null,
    });
    expect(result.allowed).toBe(false);
    expect(result.blockingReason).toBe('TASK_NOT_PAUSED_CHAIN_FAILURE');
  });
});
