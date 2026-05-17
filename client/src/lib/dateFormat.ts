/**
 * Shared date/time formatters used across chat-style surfaces (agent-chat,
 * config-assistant, future conversational UIs). Lifted from two identical
 * copies in `components/agent-chat/format.ts` and
 * `components/config-assistant/format.ts` (PAGE-SPLITS-T1).
 *
 * Keep these pure — no React, no fetch, no client-side singleton state.
 * If a future surface needs locale-aware formatting (the current
 * implementations use the user's browser default), thread the locale via
 * a parameter rather than reading it from a global.
 */

/**
 * Renders a timestamp as either a same-day "HH:MM" or a "Mon DD HH:MM" line.
 * Used as the per-message timestamp affix in agent-chat and config-assistant.
 */
export function formatTime(dateStr: string): string {
  const d = new Date(dateStr);
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  if (isToday) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/**
 * Renders a conversation-list date as one of: "Today" / "Yesterday" / "Nd ago"
 * / "Mon DD". Used in the left-rail conversation picker.
 */
export function formatConvDate(dateStr: string): string {
  const d = new Date(dateStr);
  const now = new Date();
  const diffDays = Math.floor((now.getTime() - d.getTime()) / 86400000);
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays}d ago`;
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}
