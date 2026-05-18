/**
 * UI-TARS grammar version this build is pinned against.
 * Bump in the same commit as the parser fixture file when the upstream grammar changes.
 * Source: https://github.com/bytedance/UI-TARS/releases
 */
export const UI_TARS_GRAMMAR_VERSION = 'bytedance/UI-TARS@bc25e5f' as const;

/**
 * Decision mode for an IEE browser task (spec §16 item 7).
 * - `dom`    — Playwright DOM-based action only; no vision inference called.
 * - `vision` — UI-TARS vision-grounding loop; Playwright executes typed actions.
 * - `hybrid` — DOM-first with vision fallback when DOM selector confidence is low.
 */
export type VisionDecisionMode = 'dom' | 'vision' | 'hybrid';

/**
 * Discriminated union of every action type the UI-TARS model can emit (spec §8.1).
 * Exactly 9 variants; adding a 10th requires a spec amendment.
 *
 * Invariants (enforced by the parser in visionActionParserPure.ts):
 * - `x`, `y`  — non-negative integers (≥ 0)
 * - `dx`, `dy` — signed integers (any integer value)
 * - `ms`       — positive integer (> 0)
 * - `type: 'done'`       terminates the vision loop.
 * - `type: 'screenshot'` is observe-only; no DOM side-effect.
 */
export type VisionAction =
  | { type: 'click';        x: number; y: number }
  | { type: 'double_click'; x: number; y: number }
  | { type: 'right_click';  x: number; y: number }
  | { type: 'type';         text: string }
  | { type: 'scroll';       dx: number; dy: number }
  | { type: 'hotkey';       combo: string }
  | { type: 'wait';         ms: number }
  | { type: 'screenshot' }
  | { type: 'done' };
