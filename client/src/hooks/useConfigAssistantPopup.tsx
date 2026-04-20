/**
 * useConfigAssistantPopup — trigger hook + context provider for the
 * Configuration Assistant popup (Session 1 / spec §5).
 *
 * The popup is mounted once at the App shell (see App.tsx). This hook exposes
 * `openConfigAssistant(initialPrompt?)` to any component tree via React
 * context so nav buttons, contextual triggers, and deep-links all converge
 * on the single mount point.
 *
 * Session resume window (spec contract (k)): opening the popup resumes the
 * most recent agent run &lt; 15 minutes old, else creates a fresh one. The
 * resume pointer lives in sessionStorage under
 * `configAssistant.activeConversationId`. Closing the popup does not kill
 * the run — the minimised pill surfaces background execution.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

export const CONFIG_ASSISTANT_ACTIVE_CONV_KEY = 'configAssistant.activeConversationId';
export const CONFIG_ASSISTANT_RESUME_WINDOW_MIN = 15;

interface ConfigAssistantPopupContextValue {
  open: boolean;
  initialPrompt: string | null;
  openConfigAssistant: (initialPrompt?: string) => void;
  closeConfigAssistant: () => void;
}

const ConfigAssistantPopupContext = createContext<ConfigAssistantPopupContextValue | null>(null);

export function ConfigAssistantPopupProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [initialPrompt, setInitialPrompt] = useState<string | null>(null);
  const location = useLocation();
  const navigate = useNavigate();

  const openConfigAssistant = useCallback((prompt?: string) => {
    setInitialPrompt(prompt ?? null);
    setOpen(true);
  }, []);

  const closeConfigAssistant = useCallback(() => {
    setOpen(false);
  }, []);

  // Spec §5.5 deep-link support: ?config-assistant=open&prompt=<url-encoded>.
  // On URL match, open the popup with the seeded prompt and strip the query
  // params so back-navigation doesn't re-open indefinitely.
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (params.get('config-assistant') !== 'open') return;
    const prompt = params.get('prompt') ?? undefined;
    openConfigAssistant(prompt);
    params.delete('config-assistant');
    params.delete('prompt');
    const nextSearch = params.toString();
    navigate(
      { pathname: location.pathname, search: nextSearch ? `?${nextSearch}` : '' },
      { replace: true },
    );
  }, [location.pathname, location.search, navigate, openConfigAssistant]);

  const value = useMemo<ConfigAssistantPopupContextValue>(
    () => ({ open, initialPrompt, openConfigAssistant, closeConfigAssistant }),
    [open, initialPrompt, openConfigAssistant, closeConfigAssistant],
  );

  return (
    <ConfigAssistantPopupContext.Provider value={value}>
      {children}
    </ConfigAssistantPopupContext.Provider>
  );
}

export function useConfigAssistantPopup(): ConfigAssistantPopupContextValue {
  const ctx = useContext(ConfigAssistantPopupContext);
  if (!ctx) {
    throw new Error('useConfigAssistantPopup must be used inside ConfigAssistantPopupProvider');
  }
  return ctx;
}
