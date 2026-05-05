export function trackPendingCardOpened(props: {
  kind: string;
  lane: string;
  itemId: string;
  resolvedVia: 'backend' | 'fallback';
}): void {
  try {
    console.debug('[telemetry]', 'pending_card_opened', props);
  } catch {
    /* swallow */
  }
}

export function trackPendingCardApproved(props: {
  kind: string;
  lane: string;
  itemId: string;
}): void {
  try {
    console.debug('[telemetry]', 'pending_card_approved', props);
  } catch {
    /* swallow */
  }
}

export function trackPendingCardRejected(props: {
  kind: string;
  lane: string;
  itemId: string;
}): void {
  try {
    console.debug('[telemetry]', 'pending_card_rejected', props);
  } catch {
    /* swallow */
  }
}

export function trackActivityLogViewed(props: {
  rowCount: number;
  typesPresent: string[];
}): void {
  try {
    console.debug('[telemetry]', 'activity_log_viewed', props);
  } catch {
    /* swallow */
  }
}

export function trackRunLogOpened(props: {
  runId: string;
  activityType: string;
  triggerType: string | null;
}): void {
  try {
    console.debug('[telemetry]', 'run_log_opened', props);
  } catch {
    /* swallow */
  }
}
