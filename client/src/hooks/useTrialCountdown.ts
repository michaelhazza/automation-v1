import { useState, useEffect } from 'react';
import api from '../lib/api';

export interface TrialCountdownResult {
  label: string | null;
  severity: 'muted' | 'warn' | 'danger' | null;
}

export function useTrialCountdown(): TrialCountdownResult {
  const [trialEndsAt, setTrialEndsAt] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    api.get('/api/my-subscription').then(({ data }) => {
      setStatus(data.status ?? null);
      setTrialEndsAt(data.trialEndsAt ?? null);
    }).catch(() => { /* not available yet */ });
  }, []);

  if (status !== 'trialing' || !trialEndsAt) return { label: null, severity: null };

  const msLeft = new Date(trialEndsAt).getTime() - Date.now();
  if (msLeft <= 0) return { label: null, severity: null };
  const daysLeft = Math.ceil(msLeft / (1000 * 60 * 60 * 24));

  const label =
    daysLeft > 7 ? `${daysLeft} days left in trial` :
    daysLeft > 2 ? `${daysLeft} days left in trial` :
    daysLeft === 2 ? 'Trial ends in 2 days' :
    daysLeft === 1 ? 'Trial ends tomorrow' :
    'Trial ends today';

  const severity: 'muted' | 'warn' | 'danger' =
    daysLeft > 7 ? 'muted' :
    daysLeft > 2 ? 'warn' :
    'danger';

  return { label, severity };
}
