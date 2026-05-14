/**
 * ieeDevBackendPure — pure classification tests.
 *
 * Spec B §18.2, §18.4, §25.
 * Covers every known DevTaskPayload variant the iee_dev adapter dispatches
 * today (V1). The adapter only dispatches DevTaskPayload (type='dev');
 * BrowserTaskPayload is dispatched by iee_browser.
 *
 * Run: npx vitest run server/services/executionBackends/__tests__/ieeDevBackendPure.test.ts
 */

import { describe, expect, it } from 'vitest';
import type { DevTaskPayload } from '../../../../shared/iee/jobPayload.js';
import { classifyExecutionClass } from '../ieeDevBackendPure.js';

// ---------------------------------------------------------------------------
// Helpers — minimal valid DevTaskPayload fixtures.
// All fields are optional except `type` and `goal`.
// ---------------------------------------------------------------------------

function makeDevTask(overrides: Partial<DevTaskPayload>): DevTaskPayload {
  return {
    type: 'dev',
    goal: 'default test goal',
    ...overrides,
  } as DevTaskPayload;
}

// ---------------------------------------------------------------------------
// Variant 1: minimal goal-only task (no repo, no commands)
// ---------------------------------------------------------------------------
describe('classifyExecutionClass — minimal goal-only variant', () => {
  it('classifies as worker_trusted', () => {
    const task = makeDevTask({ goal: 'Summarise the project codebase' });
    expect(classifyExecutionClass(task)).toBe('worker_trusted');
  });
});

// ---------------------------------------------------------------------------
// Variant 2: repo checkout + branch (full git workflow)
// ---------------------------------------------------------------------------
describe('classifyExecutionClass — repo + branch variant', () => {
  it('classifies as worker_trusted when repoUrl and branch are present', () => {
    const task = makeDevTask({
      goal: 'Run tests on the feature branch',
      repoUrl: 'https://github.com/org/repo.git',
      branch: 'feature/new-feature',
    });
    expect(classifyExecutionClass(task)).toBe('worker_trusted');
  });
});

// ---------------------------------------------------------------------------
// Variant 3: commands array (shell commands in the worker)
// ---------------------------------------------------------------------------
describe('classifyExecutionClass — commands variant', () => {
  it('classifies as worker_trusted when commands are present', () => {
    const task = makeDevTask({
      goal: 'Build and test the project',
      commands: ['npm install', 'npm run build', 'npm run test:unit'],
    });
    expect(classifyExecutionClass(task)).toBe('worker_trusted');
  });

  it('classifies as worker_trusted for a single command', () => {
    const task = makeDevTask({
      goal: 'Run lint',
      commands: ['npm run lint'],
    });
    expect(classifyExecutionClass(task)).toBe('worker_trusted');
  });

  it('classifies as worker_trusted for an empty commands array', () => {
    const task = makeDevTask({
      goal: 'Setup environment',
      commands: [],
    });
    expect(classifyExecutionClass(task)).toBe('worker_trusted');
  });
});

// ---------------------------------------------------------------------------
// Variant 4: repo + commands (git checkout then build/test sequence)
// ---------------------------------------------------------------------------
describe('classifyExecutionClass — repo + commands combined variant', () => {
  it('classifies as worker_trusted', () => {
    const task = makeDevTask({
      goal: 'Checkout and validate the release branch',
      repoUrl: 'https://github.com/org/repo.git',
      branch: 'release/v2.0',
      commands: ['npm ci', 'npm run build', 'npm run typecheck'],
    });
    expect(classifyExecutionClass(task)).toBe('worker_trusted');
  });
});

// ---------------------------------------------------------------------------
// Variant 5: repo + branch + checks (quality-check configuration)
// ---------------------------------------------------------------------------
describe('classifyExecutionClass — repo + branch + checks variant', () => {
  it('classifies as worker_trusted with all quality checks configured', () => {
    const task = makeDevTask({
      goal: 'Implement feature and validate quality gates',
      repoUrl: 'https://github.com/org/synthetos.git',
      branch: 'main',
      checks: {
        lintCommand: 'npm run lint',
        typecheckCommand: 'npm run typecheck',
        testCommand: 'npx vitest run',
      },
    });
    expect(classifyExecutionClass(task)).toBe('worker_trusted');
  });

  it('classifies as worker_trusted with partial checks (lint only)', () => {
    const task = makeDevTask({
      goal: 'Lint the repository',
      checks: {
        lintCommand: 'npm run lint',
      },
    });
    expect(classifyExecutionClass(task)).toBe('worker_trusted');
  });

  it('classifies as worker_trusted with partial checks (typecheck only)', () => {
    const task = makeDevTask({
      goal: 'Typecheck the repository',
      checks: {
        typecheckCommand: 'npm run typecheck',
      },
    });
    expect(classifyExecutionClass(task)).toBe('worker_trusted');
  });

  it('classifies as worker_trusted with partial checks (test only)', () => {
    const task = makeDevTask({
      goal: 'Run all unit tests',
      checks: {
        testCommand: 'npx vitest run',
      },
    });
    expect(classifyExecutionClass(task)).toBe('worker_trusted');
  });
});

// ---------------------------------------------------------------------------
// Variant 6: fully specified task (all optional fields present)
// ---------------------------------------------------------------------------
describe('classifyExecutionClass — fully specified variant', () => {
  it('classifies as worker_trusted with all fields present', () => {
    const task = makeDevTask({
      goal: 'Full dev workflow: checkout, build, test, and validate',
      repoUrl: 'https://github.com/org/synthetos.git',
      branch: 'claude/new-feature',
      commands: ['npm ci', 'npm run build:server', 'npm run build:client'],
      checks: {
        lintCommand: 'npm run lint',
        typecheckCommand: 'npm run typecheck',
        testCommand: 'npx vitest run server/services',
      },
    });
    expect(classifyExecutionClass(task)).toBe('worker_trusted');
  });
});

// ---------------------------------------------------------------------------
// Classification table: no task variant currently returns 'sandbox' or
// 'worker_orchestration'. These are reserved for future payload variants
// (e.g. task.kind === 'data_transform' for Revenue Ops CSV parsing).
// ---------------------------------------------------------------------------
describe('classifyExecutionClass — return type invariants', () => {
  it('never returns sandbox for any current V1 DevTaskPayload variant', () => {
    const variants: DevTaskPayload[] = [
      makeDevTask({ goal: 'minimal' }),
      makeDevTask({ goal: 'with repo', repoUrl: 'https://github.com/org/repo.git' }),
      makeDevTask({ goal: 'with commands', commands: ['echo hello'] }),
      makeDevTask({ goal: 'with checks', checks: { lintCommand: 'npm run lint' } }),
    ];
    for (const task of variants) {
      expect(classifyExecutionClass(task)).not.toBe('sandbox');
    }
  });

  it('never returns worker_orchestration for any current V1 DevTaskPayload variant', () => {
    const variants: DevTaskPayload[] = [
      makeDevTask({ goal: 'minimal' }),
      makeDevTask({ goal: 'with repo', repoUrl: 'https://github.com/org/repo.git' }),
      makeDevTask({ goal: 'with commands', commands: ['npm run build'] }),
    ];
    for (const task of variants) {
      expect(classifyExecutionClass(task)).not.toBe('worker_orchestration');
    }
  });
});
