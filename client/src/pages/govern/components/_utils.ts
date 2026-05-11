// client/src/pages/govern/components/_utils.ts
// Shared helpers for govern tab components.

/**
 * Formats an ISO timestamp relative to now.
 * Canonical variant: floor at <2 min → "Just now", "N minutes ago",
 * "1 hour ago" / "N hours ago", "Yesterday" / "N days ago", then locale date.
 */
export function formatRelative(iso: string | null): string {
  if (!iso) return 'Never';
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 2) return 'Just now';
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs === 1 ? '1 hour' : `${hrs} hours`} ago`;
  const days = Math.floor(hrs / 24);
  if (days === 1) return 'Yesterday';
  if (days < 30) return `${days} days ago`;
  return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}
