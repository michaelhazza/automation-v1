import { useEffect, useRef, useState } from 'react';

export type PopupStatus = 'idle' | 'pending' | 'success' | 'error';

export function useOAuthPopup() {
  const [status, setStatus] = useState<PopupStatus>('idle');
  const popupRef = useRef<Window | null>(null);
  const mountedRef = useRef(true);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    mountedRef.current = true;

    const handleMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      if (event.data?.type === 'oauth_success') {
        if (mountedRef.current) setStatus('success');
        popupRef.current?.close();
        if (intervalRef.current) {
          clearInterval(intervalRef.current);
          intervalRef.current = null;
        }
      }
    };

    window.addEventListener('message', handleMessage);
    return () => {
      mountedRef.current = false;
      window.removeEventListener('message', handleMessage);
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, []);

  const open = (url: string) => {
    // Close any existing popup before opening a new one
    popupRef.current?.close();
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }

    const popup = window.open(
      url,
      'oauth_popup',
      'width=600,height=700,scrollbars=yes,resizable=yes',
    );

    if (!popup) {
      // Popup blocked — fall back to same-tab navigation
      window.location.href = url;
      return;
    }

    popupRef.current = popup;
    setStatus('pending');

    // Poll for popup close so we can reset to idle if the user closes without
    // completing the OAuth flow.
    intervalRef.current = setInterval(() => {
      if (popup.closed) {
        if (intervalRef.current) {
          clearInterval(intervalRef.current);
          intervalRef.current = null;
        }
        // Only reset to idle if the popup closed without success
        if (mountedRef.current) {
          setStatus((prev) => (prev === 'pending' ? 'idle' : prev));
        }
      }
    }, 500);
  };

  const reset = () => {
    setStatus('idle');
    popupRef.current?.close();
    popupRef.current = null;
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  };

  return { open, status, reset };
}
