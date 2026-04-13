import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

interface ModalProps {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  maxWidth?: number;
  disableBackdropClose?: boolean;
}

export default function Modal({ title, onClose, children, maxWidth = 520, disableBackdropClose = false }: ModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<Element | null>(null);

  useEffect(() => {
    // Store the previously focused element to restore on close
    previousFocusRef.current = document.activeElement;

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
      // Restore focus to previously active element
      if (previousFocusRef.current instanceof HTMLElement) {
        previousFocusRef.current.focus();
      }
    };
  }, [onClose]);

  return createPortal(
    <div
      onClick={disableBackdropClose ? undefined : onClose}
      className="fixed inset-0 z-[1000] bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-6 animate-[fadeIn_0.15s_ease-out_both]"
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
        style={{ maxWidth }}
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
        <div className="px-6 pt-5 pb-6">
          {children}
        </div>
      </div>
    </div>,
    document.body
  );
}
