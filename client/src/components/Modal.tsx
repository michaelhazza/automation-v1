import { useEffect } from 'react';
import { createPortal } from 'react-dom';

interface ModalProps {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  maxWidth?: number;
}

export default function Modal({ title, onClose, children, maxWidth = 520 }: ModalProps) {
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onClose]);

  return createPortal(
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(15, 23, 42, 0.6)',
        backdropFilter: 'blur(4px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 24,
        animation: 'fadeIn 0.15s ease-out both',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: '#fff', borderRadius: 16, width: '100%', maxWidth,
          boxShadow: '0 24px 64px rgba(0,0,0,0.2), 0 8px 24px rgba(0,0,0,0.12)',
          maxHeight: 'calc(100vh - 48px)', overflow: 'auto',
          animation: 'fadeInScale 0.18s ease-out both',
        }}
      >
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          padding: '20px 24px', borderBottom: '1px solid #f1f5f9',
        }}>
          <h2 style={{ fontSize: 16, fontWeight: 700, color: '#0f172a', margin: 0, letterSpacing: '-0.01em' }}>{title}</h2>
          <button
            onClick={onClose}
            style={{
              background: '#f1f5f9', border: 'none', cursor: 'pointer',
              color: '#64748b', width: 28, height: 28,
              borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 16, lineHeight: 1, transition: 'background 0.1s, color 0.1s',
              fontFamily: 'inherit',
            }}
          >
            ×
          </button>
        </div>
        <div style={{ padding: '20px 24px 24px' }}>
          {children}
        </div>
      </div>
    </div>,
    document.body
  );
}
