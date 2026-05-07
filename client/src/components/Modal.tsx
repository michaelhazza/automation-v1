import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { acquireScrollLock, releaseScrollLock } from './overlayScrollLock';

/**
 * Size token map:
 *   sm  → 480px
 *   md  → 720px
 *   lg  → 1024px
 *   xl  → 1280px
 *   iframe → calc(100vw - 64px)
 *
 * Precedence: when both `size` and `maxWidth` are supplied, `size` wins and a dev
 * warning is emitted. This prevents silent conflicts when wrapping consumers add `size`
 * to an existing call site that already passes `maxWidth`.
 */
const SIZE_MAP: Record<string, string | number> = {
  sm: 480,
  md: 720,
  lg: 1024,
  xl: 1280,
  iframe: 'calc(100vw - 64px)',
};

interface ModalProps {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  // Existing
  maxWidth?: number;
  disableBackdropClose?: boolean;
  // NEW
  /** Size token. When provided, takes precedence over `maxWidth`. */
  size?: 'sm' | 'md' | 'lg' | 'xl' | 'iframe';
  /** Optional footer rendered below the body, inside the dialog shell. */
  footer?: React.ReactNode;
  /** Body padding preset. 'none' removes padding for full-bleed content. */
  bodyPadding?: 'default' | 'none';
  /**
   * z-index for the backdrop layer. The dialog panel is a descendant rendered after
   * the backdrop in DOM order, so it naturally paints on top within the same stacking
   * context — no separate z-index is needed on the panel. Default: 1000.
   */
  zIndex?: number;
}

export default function Modal({
  title,
  onClose,
  children,
  maxWidth = 520,
  disableBackdropClose = false,
  size,
  footer,
  bodyPadding = 'default',
  zIndex = 1000,
}: ModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<Element | null>(null);

  // Warn in dev when both size and maxWidth are explicitly supplied.
  // NOTE: We compare against the default value (520) as a heuristic — we cannot
  // distinguish "caller passed maxWidth={520}" from "prop received its default."
  // The warning is best-effort; the precedence rule (size wins) is always enforced.
  if (size !== undefined && maxWidth !== 520 && process.env.NODE_ENV !== 'production') {
    console.warn(
      '[Modal] Both `size` and `maxWidth` were supplied. `size` takes precedence; `maxWidth` is ignored.'
    );
  }

  // Resolve effective max-width: size wins over maxWidth.
  const resolvedMaxWidth: string | number = size !== undefined ? SIZE_MAP[size] : maxWidth;

  useEffect(() => {
    // Store the previously focused element to restore on close
    previousFocusRef.current = document.activeElement;

    acquireScrollLock();

    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onClose(); return; }

      // Focus trap: cycle focus within modal on Tab
      if (e.key === 'Tab' && dialogRef.current) {
        const focusable = dialogRef.current.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        );
        if (focusable.length === 0) { e.preventDefault(); return; }
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', handleKey);

    // Auto-focus the dialog on mount
    dialogRef.current?.focus();

    return () => {
      document.removeEventListener('keydown', handleKey);
      releaseScrollLock();
      // Restore focus to previously active element
      if (previousFocusRef.current instanceof HTMLElement) {
        previousFocusRef.current.focus();
      }
    };
  }, [onClose]);

  return createPortal(
    <div
      onClick={disableBackdropClose ? undefined : onClose}
      className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-6 animate-[fadeIn_0.15s_ease-out_both]"
      style={{ zIndex }}
      role="presentation"
    >
      <div
        ref={dialogRef}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className="bg-white rounded-2xl w-full shadow-[0_24px_64px_rgba(0,0,0,0.2),0_8px_24px_rgba(0,0,0,0.12)] max-h-[calc(100vh-48px)] overflow-auto animate-[fadeInScale_0.18s_ease-out_both] outline-none"
        style={{ maxWidth: resolvedMaxWidth }}
      >
        <div className="flex justify-between items-center px-6 py-5 border-b border-slate-100">
          <h2 className="text-base font-bold text-slate-900 m-0 tracking-tight">{title}</h2>
          <button
            onClick={onClose}
            aria-label="Close dialog"
            className="bg-slate-100 border-0 cursor-pointer text-slate-500 w-7 h-7 rounded-md flex items-center justify-center text-base leading-none transition-[background,color] duration-100 font-[inherit] hover:bg-slate-200 hover:text-slate-700"
          >
            ×
          </button>
        </div>
        <div className={bodyPadding === 'none' ? '' : 'px-6 pt-5 pb-6'}>
          {children}
        </div>
        {footer && (
          <div className="px-6 py-4 border-t border-slate-100">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}
