// visionActions.ts — vision-grounding action grammar and decision-mode enum
// Spec §8.1 (vision action schema), §8.9 (decision-mode enum)

export type VisionDecisionMode = 'dom' | 'vision' | 'hybrid';

/**
 * Discriminated union of the 9-verb UI-TARS action grammar.
 *
 * Verbs: click, double_click, right_click, type, scroll, hotkey, wait, screenshot, done
 *
 * Invariants:
 *   - x, y   — non-negative integers (viewport pixel coordinates)
 *   - dx, dy — signed integers (scroll delta in pixels; positive scrolls down/right)
 *   - ms     — positive integer (milliseconds to pause)
 *   - screenshot — observe-only; no action is executed on the browser
 *   - done   — terminal verb; the harness loop exits when this is emitted
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
