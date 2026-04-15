import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

// ---------------------------------------------------------------------------
// HelpHint — hover/focus/tap help primitive
// Spec: docs/onboarding-playbooks-spec.md §6
//
// Renders a small question-mark-in-a-circle icon next to a label. The popover
// opens on hover (150 ms dwell), keyboard focus, or click/tap, and closes on
// Escape, blur, outside click, or pointer-leave. Uses a portal rooted at
// `#help-hint-portal` (injected once in App.tsx) so it never fights with
// modal z-index.
//
// Positioning is a hand-rolled ~60-line auto-flip — we explicitly do NOT
// pull in `@floating-ui/*` for this one primitive. The spec permits this
// tradeoff (§6.3 implementation notes).
// ---------------------------------------------------------------------------

export interface HelpHintProps {
  /** Plain-text content. HTML and markdown are rejected — React auto-escapes. */
  text: string;
  /** Screen reader label for the trigger. Defaults to "More information". */
  ariaLabel?: string;
  /** Preferred placement. Auto-flips if it would clip. Default: 'top'. */
  placement?: 'top' | 'bottom' | 'left' | 'right';
  /** Disable hover; open only on click/tap/keyboard. */
  clickOnly?: boolean;
}

type Placement = 'top' | 'bottom' | 'left' | 'right';

interface PopoverRect {
  top: number;
  left: number;
  placement: Placement;
}

const HOVER_OPEN_MS = 150;
const HOVER_CLOSE_MS = 100;
const POPOVER_MAX_WIDTH = 288; // ~18rem — slightly under the 22rem spec upper bound to leave padding
const POPOVER_OFFSET = 8;
const VIEWPORT_MARGIN = 8;

function computePosition(
  triggerRect: DOMRect,
  popoverRect: { width: number; height: number },
  preferred: Placement,
): PopoverRect {
  const viewportW = window.innerWidth;
  const viewportH = window.innerHeight;

  const fits = (p: Placement): boolean => {
    switch (p) {
      case 'top':
        return triggerRect.top - popoverRect.height - POPOVER_OFFSET >= VIEWPORT_MARGIN;
      case 'bottom':
        return triggerRect.bottom + popoverRect.height + POPOVER_OFFSET <= viewportH - VIEWPORT_MARGIN;
      case 'left':
        return triggerRect.left - popoverRect.width - POPOVER_OFFSET >= VIEWPORT_MARGIN;
      case 'right':
        return triggerRect.right + popoverRect.width + POPOVER_OFFSET <= viewportW - VIEWPORT_MARGIN;
    }
  };

  // Try preferred, then the opposite, then the perpendicular pair, then bottom as final fallback.
  const opposite: Record<Placement, Placement> = { top: 'bottom', bottom: 'top', left: 'right', right: 'left' };
  const perpendicular: Record<Placement, Placement[]> = {
    top: ['bottom', 'right', 'left'],
    bottom: ['top', 'right', 'left'],
    left: ['right', 'bottom', 'top'],
    right: ['left', 'bottom', 'top'],
  };
  const order: Placement[] = [preferred, opposite[preferred], ...perpendicular[preferred]];
  const chosen = order.find(fits) ?? 'bottom';

  let top = 0;
  let left = 0;
  switch (chosen) {
    case 'top':
      top = triggerRect.top - popoverRect.height - POPOVER_OFFSET;
      left = triggerRect.left + triggerRect.width / 2 - popoverRect.width / 2;
      break;
    case 'bottom':
      top = triggerRect.bottom + POPOVER_OFFSET;
      left = triggerRect.left + triggerRect.width / 2 - popoverRect.width / 2;
      break;
    case 'left':
      top = triggerRect.top + triggerRect.height / 2 - popoverRect.height / 2;
      left = triggerRect.left - popoverRect.width - POPOVER_OFFSET;
      break;
    case 'right':
      top = triggerRect.top + triggerRect.height / 2 - popoverRect.height / 2;
      left = triggerRect.right + POPOVER_OFFSET;
      break;
  }

  // Clamp horizontally/vertically so we never overflow the viewport.
  left = Math.max(VIEWPORT_MARGIN, Math.min(left, viewportW - popoverRect.width - VIEWPORT_MARGIN));
  top = Math.max(VIEWPORT_MARGIN, Math.min(top, viewportH - popoverRect.height - VIEWPORT_MARGIN));

  return { top, left, placement: chosen };
}

export function HelpHint(props: HelpHintProps) {
  const { text, ariaLabel = 'More information', placement = 'top', clickOnly = false } = props;
  // §G5.3 — runtime guard: truncate at 280 chars with an ellipsis.
  // The lint gate (scripts/verify-help-hint-length.mjs) covers static strings;
  // this handles dynamic or template-literal text that bypasses the gate.
  const displayText = text.length > 280 ? text.slice(0, 279) + '…' : text;

  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const openTimerRef = useRef<number | null>(null);
  const closeTimerRef = useRef<number | null>(null);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<PopoverRect | null>(null);
  const popoverId = useId();

  const clearTimers = useCallback(() => {
    if (openTimerRef.current !== null) {
      window.clearTimeout(openTimerRef.current);
      openTimerRef.current = null;
    }
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }, []);

  const doOpen = useCallback(() => {
    clearTimers();
    setOpen(true);
  }, [clearTimers]);

  const doClose = useCallback(() => {
    clearTimers();
    setOpen(false);
  }, [clearTimers]);

  const scheduleOpen = useCallback(() => {
    if (clickOnly) return;
    clearTimers();
    openTimerRef.current = window.setTimeout(() => setOpen(true), HOVER_OPEN_MS);
  }, [clickOnly, clearTimers]);

  const scheduleClose = useCallback(() => {
    if (clickOnly) return;
    clearTimers();
    closeTimerRef.current = window.setTimeout(() => setOpen(false), HOVER_CLOSE_MS);
  }, [clickOnly, clearTimers]);

  const handleBlur = useCallback((e: React.FocusEvent) => {
    // Don't close if focus is moving into the popover (e.g. user tabs to a
    // link inside the tooltip content).
    const next = e.relatedTarget as Node | null;
    if (popoverRef.current?.contains(next)) return;
    scheduleClose();
  }, [scheduleClose]);

  // Measure + position on open, and on resize / scroll while open.
  // Scroll listener uses capture=true so it fires for nested scroll containers
  // too (e.g. modals, overflow-auto panels). The RAF throttle keeps it cheap.
  useEffect(() => {
    if (!open) {
      setPosition(null);
      return;
    }
    let rafId: number | null = null;
    const place = () => {
      const trigger = triggerRef.current;
      const popover = popoverRef.current;
      if (!trigger || !popover) return;
      const tRect = trigger.getBoundingClientRect();
      const pRect = { width: popover.offsetWidth, height: popover.offsetHeight };
      setPosition(computePosition(tRect, pRect, placement));
    };
    const placeThrottled = () => {
      if (rafId !== null) return;
      rafId = window.requestAnimationFrame(() => {
        rafId = null;
        place();
      });
    };
    place();
    window.addEventListener('scroll', placeThrottled, true);
    window.addEventListener('resize', placeThrottled);
    return () => {
      window.removeEventListener('scroll', placeThrottled, true);
      window.removeEventListener('resize', placeThrottled);
      if (rafId !== null) window.cancelAnimationFrame(rafId);
    };
  }, [open, placement]);

  // Dismissal: Escape always closes and returns focus to the trigger.
  // Outside click / tap always closes.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        doClose();
        triggerRef.current?.focus();
      }
    };
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node | null;
      if (!target) return;
      if (triggerRef.current?.contains(target)) return;
      if (popoverRef.current?.contains(target)) return;
      doClose();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointerDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointerDown);
    };
  }, [open, doClose]);

  // Cleanup any pending timer on unmount.
  useEffect(() => {
    return () => clearTimers();
  }, [clearTimers]);

  const portalRoot =
    typeof document !== 'undefined'
      ? document.getElementById('help-hint-portal') ?? document.body
      : null;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-label={ariaLabel}
        aria-describedby={open ? popoverId : undefined}
        aria-expanded={open}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          open ? doClose() : doOpen();
        }}
        onFocus={() => { if (!clickOnly) doOpen(); }}
        onBlur={handleBlur}
        onMouseEnter={scheduleOpen}
        onMouseLeave={scheduleClose}
        className="inline-flex items-center justify-center w-4 h-4 rounded-full text-slate-400 hover:text-slate-600 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-1 transition-colors cursor-help align-middle"
      >
        {/* Hand-rolled SVG — no icon lib (project convention). */}
        <svg
          viewBox="0 0 14 14"
          width="14"
          height="14"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.25"
          aria-hidden="true"
          focusable="false"
        >
          <circle cx="7" cy="7" r="6" />
          <path
            d="M5.3 5.3a1.7 1.7 0 1 1 2.3 1.58c-.48.2-.9.5-.9 1.12v.4"
            strokeLinecap="round"
          />
          <circle cx="7" cy="10.2" r="0.4" fill="currentColor" stroke="none" />
        </svg>
      </button>

      {open && portalRoot
        ? createPortal(
            <div
              id={popoverId}
              ref={popoverRef}
              role="tooltip"
              onMouseEnter={clearTimers}
              onMouseLeave={scheduleClose}
              style={{
                position: 'fixed',
                top: position?.top ?? -9999,
                left: position?.left ?? -9999,
                maxWidth: POPOVER_MAX_WIDTH,
                maxHeight: '15rem',
                visibility: position ? 'visible' : 'hidden',
              }}
              className="z-[2000] overflow-auto rounded-md bg-slate-900 text-slate-50 text-[12px] leading-[1.4] px-3 py-2 shadow-lg whitespace-pre-wrap break-words pointer-events-auto"
            >
              {displayText}
            </div>,
            portalRoot,
          )
        : null}
    </>
  );
}

export default HelpHint;
