// client/src/components/Drawer.tsx
//
// Portal-rendered side-drawer overlay.
// zIndex=900 (one level below Modal's 1000).

import React, { useEffect, useRef, useCallback } from 'react';
import ReactDOM from 'react-dom';
import { acquireScrollLock, releaseScrollLock } from './overlayScrollLock';

export interface DrawerProps {
  open: boolean;
  side?: 'right' | 'left';
  width?: number | string;
  title?: string;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
}

const FOCUSABLE_SELECTORS = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

export function Drawer({
  open,
  side = 'right',
  width = 480,
  title,
  onClose,
  children,
  footer,
}: DrawerProps): React.ReactPortal | null {
  const panelRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<Element | null>(null);

  // Keyboard handler: Esc closes
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
        return;
      }

      // Focus trap: keep Tab cycling within the drawer
      if (e.key === 'Tab' && panelRef.current) {
        const focusable = Array.from(
          panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTORS),
        ).filter((el) => el.offsetParent !== null); // exclude hidden elements

        if (focusable.length === 0) {
          e.preventDefault();
          return;
        }

        const first = focusable[0];
        const last = focusable[focusable.length - 1];

        if (e.shiftKey) {
          if (document.activeElement === first) {
            e.preventDefault();
            last.focus();
          }
        } else {
          if (document.activeElement === last) {
            e.preventDefault();
            first.focus();
          }
        }
      }
    },
    [onClose],
  );

  useEffect(() => {
    if (!open) return;

    // Snapshot the currently focused element so we can restore it on close
    previousFocusRef.current = document.activeElement;

    acquireScrollLock();
    document.addEventListener('keydown', handleKeyDown);

    // Move initial focus into the panel
    const raf = requestAnimationFrame(() => {
      if (panelRef.current) {
        const firstFocusable = panelRef.current.querySelector<HTMLElement>(FOCUSABLE_SELECTORS);
        if (firstFocusable) {
          firstFocusable.focus();
        } else {
          panelRef.current.focus();
        }
      }
    });

    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener('keydown', handleKeyDown);
      releaseScrollLock();

      // Restore focus to the element that was active before the drawer opened
      if (previousFocusRef.current instanceof HTMLElement) {
        previousFocusRef.current.focus();
      }
    };
  }, [open, handleKeyDown]);

  if (!open) return null;

  const resolvedWidth = typeof width === 'number' ? `${width}px` : width;

  const panel = (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 900,
        display: 'flex',
        flexDirection: side === 'right' ? 'row-reverse' : 'row',
      }}
    >
      {/* Backdrop */}
      <div
        aria-hidden="true"
        onClick={onClose}
        style={{
          position: 'absolute',
          inset: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.4)',
          animation: 'drawer-fade-in 150ms ease',
        }}
      />

      {/* Drawer panel */}
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title ?? 'Drawer'}
        tabIndex={-1}
        style={{
          position: 'relative',
          display: 'flex',
          flexDirection: 'column',
          width: resolvedWidth,
          maxWidth: '100vw',
          height: '100%',
          backgroundColor: 'white',
          boxShadow:
            side === 'right'
              ? '-4px 0 24px rgba(0,0,0,0.12)'
              : '4px 0 24px rgba(0,0,0,0.12)',
          animation:
            side === 'right'
              ? 'drawer-slide-in-right 200ms ease'
              : 'drawer-slide-in-left 200ms ease',
          outline: 'none',
        }}
      >
        {/* Header */}
        {title && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '16px 20px',
              borderBottom: '1px solid #e5e7eb',
              flexShrink: 0,
            }}
          >
            <h2
              style={{
                margin: 0,
                fontSize: '16px',
                fontWeight: 600,
                color: '#111827',
              }}
            >
              {title}
            </h2>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close drawer"
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: '32px',
                height: '32px',
                borderRadius: '6px',
                border: 'none',
                background: 'transparent',
                cursor: 'pointer',
                color: '#6b7280',
                fontSize: '20px',
                lineHeight: 1,
                padding: 0,
              }}
            >
              &#x2715;
            </button>
          </div>
        )}

        {/* Body — scrollable */}
        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: '20px',
          }}
        >
          {children}
        </div>

        {/* Footer */}
        {footer && (
          <div
            style={{
              flexShrink: 0,
              padding: '16px 20px',
              borderTop: '1px solid #e5e7eb',
            }}
          >
            {footer}
          </div>
        )}
      </div>

      {/* Keyframe animations injected once */}
      <style>{`
        @keyframes drawer-fade-in {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
        @keyframes drawer-slide-in-right {
          from { transform: translateX(100%); }
          to   { transform: translateX(0); }
        }
        @keyframes drawer-slide-in-left {
          from { transform: translateX(-100%); }
          to   { transform: translateX(0); }
        }
      `}</style>
    </div>
  );

  return ReactDOM.createPortal(panel, document.body);
}

export default Drawer;
