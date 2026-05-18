// humanizeInputs.ts
// Consumer-side humanize adapter.
// Wraps Playwright page methods with realistic human-paced timing.
// In V1: pure-module timing is computed; actual Playwright calls are stub-passthrough.
// When e2b SDK is wired, replace stub with real Playwright calls.

import {
  generateMouseCurve,
  generateTypingIntervals,
  generateScrollMomentum,
  validateOptions,
  type Point,
} from './humanizeInputsPure.js';
import type { HumanizeOptions } from '../../../../shared/types/humanize.js';

export type { Point };

// Minimal page interface for the wrapper (mirrors Playwright's Page subset)
export interface PageLike {
  mouse?: { move(x: number, y: number): Promise<void> };
  keyboard?: { type(text: string, opts?: { delay?: number }): Promise<void> };
  evaluate?: (fn: (delta: number) => void, delta: number) => Promise<void>;
}

/**
 * Wrap a click action with humanized mouse movement.
 * Emits browser.humanize.applied on completion, browser.humanize.skipped on wrapper error.
 */
export async function wrapClick(
  page: PageLike,
  from: Point,
  to: Point,
  opts: HumanizeOptions,
  log: (event: string, payload: object) => void
): Promise<void> {
  try {
    validateOptions(opts);
    const curve = generateMouseCurve(from, to, opts.profile, opts.seed);
    const start = Date.now();
    // When Playwright is wired: move mouse along curve points
    // for (const pt of curve) { await page.mouse?.move(pt.x, pt.y); }
    void curve; // V1 stub: timing computed but not dispatched
    const durationMs = Date.now() - start;
    log('browser.humanize.applied', { action_type: 'click', profile: opts.profile, durationMs });
  } catch {
    log('browser.humanize.skipped', {
      action_type: 'click',
      profile: opts.profile,
      reason: 'wrapper_error',
    });
    // Do NOT rethrow — fall back to standard Playwright call in caller
  }
  void page; // referenced when Playwright is wired
}

/**
 * Wrap a type action with humanized keystroke intervals.
 */
export async function wrapType(
  page: PageLike,
  text: string,
  opts: HumanizeOptions,
  log: (event: string, payload: object) => void
): Promise<void> {
  try {
    validateOptions(opts);
    const intervals = generateTypingIntervals(text, opts.profile, opts.seed);
    const start = Date.now();
    // When Playwright is wired:
    // for (let i = 0; i < text.length; i++) {
    //   await page.keyboard?.type(text[i], { delay: intervals[i] });
    // }
    void intervals; // V1 stub
    const durationMs = Date.now() - start;
    log('browser.humanize.applied', { action_type: 'type', profile: opts.profile, durationMs });
  } catch {
    log('browser.humanize.skipped', {
      action_type: 'type',
      profile: opts.profile,
      reason: 'wrapper_error',
    });
  }
  void page; // referenced when Playwright is wired
}

/**
 * Wrap a scroll action with humanized momentum.
 */
export async function wrapScroll(
  page: PageLike,
  delta: number,
  opts: HumanizeOptions,
  log: (event: string, payload: object) => void
): Promise<void> {
  try {
    validateOptions(opts);
    const momentum = generateScrollMomentum(delta, opts.profile, opts.seed);
    const start = Date.now();
    // When Playwright is wired: dispatch scroll steps
    void momentum; // V1 stub
    const durationMs = Date.now() - start;
    log('browser.humanize.applied', { action_type: 'scroll', profile: opts.profile, durationMs });
  } catch {
    log('browser.humanize.skipped', {
      action_type: 'scroll',
      profile: opts.profile,
      reason: 'wrapper_error',
    });
  }
  void page; // referenced when Playwright is wired
}
