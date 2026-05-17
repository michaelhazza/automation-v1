import { useState, useEffect, useCallback } from 'react';

export interface CommandPaletteKeybind {
  cmdOpen: boolean;
  open(): void;
  close(): void;
}

export function useCommandPaletteKeybind(): CommandPaletteKeybind {
  const [cmdOpen, setCmdOpen] = useState(false);

  // Cmd+K to open command palette
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') { e.preventDefault(); setCmdOpen(o => !o); }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []);

  const open = useCallback(() => setCmdOpen(true), []);
  const close = useCallback(() => setCmdOpen(false), []);

  return { cmdOpen, open, close };
}
