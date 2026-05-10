// Pure formatter functions for the Credentials Audit Log component.

export const AUDIT_PROVIDER_LABELS: Record<string, string> = {
  slack: 'Slack',
  gmail: 'Gmail',
  github: 'GitHub',
  hubspot: 'HubSpot',
  ghl: 'GoHighLevel',
  teamwork: 'Teamwork',
  web_login: 'Web Login',
  custom: 'Custom',
  google_drive: 'Google Drive',
};

export function formatProviderName(providerType: string | null | undefined): string {
  if (!providerType) return 'Unknown provider';
  return AUDIT_PROVIDER_LABELS[providerType] ?? providerType;
}

export function formatAuditAction(action: string | null | undefined): string {
  if (!action) return 'Unknown action';
  switch (action) {
    case 'issued': return 'Issued';
    case 'refreshed': return 'Refreshed';
    case 'revoked': return 'Revoked';
    case 'used': return 'Used';
    default: return action.charAt(0).toUpperCase() + action.slice(1);
  }
}

export function formatAuditTimestamp(iso: string | Date | null | undefined): string {
  if (!iso) return 'Unknown time';
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  if (isNaN(d.getTime())) return 'Invalid date';
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
