/**
 * MilestoneCard — per-agent milestone event rendered in the Chat pane.
 *
 * Shows agent initials, summary text, and an optional link reference.
 * Spec: docs/workflows-dev-spec.md §9.2.
 */

const AVATAR_COLORS = [
  '#6366f1', '#8b5cf6', '#ec4899', '#f43f5e',
  '#f97316', '#22c55e', '#0ea5e9', '#14b8a6',
];

function avatarColor(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = id.charCodeAt(i) + ((h << 5) - h);
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length];
}

function toInitials(id: string): string {
  // Use first two characters of the id as a stable placeholder
  return id.slice(0, 2).toUpperCase();
}

interface LinkRef {
  kind: string;
  id: string;
  label: string;
}

interface MilestoneCardProps {
  agentId: string;
  summary: string;
  linkRef?: LinkRef;
  timestamp: string;
}

export default function MilestoneCard({ agentId, summary, linkRef, timestamp }: MilestoneCardProps) {
  return (
    <div className="flex gap-3 py-3 px-4">
      {/* Agent avatar */}
      <div
        className="shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold text-white"
        style={{ background: avatarColor(agentId) }}
        title={`Agent ${agentId}`}
      >
        {toInitials(agentId)}
      </div>

      <div className="flex-1 min-w-0">
        {/* Summary */}
        <p className="text-[13.5px] text-slate-200 leading-snug">{summary}</p>

        <div className="flex items-center gap-3 mt-1">
          {/* Timestamp */}
          <span className="text-[11px] text-slate-500">{relativeLabel(timestamp)}</span>

          {/* Optional link reference */}
          {linkRef && (
            <span className="text-[11px] text-indigo-400 cursor-pointer hover:text-indigo-300">
              {linkRef.label}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function relativeLabel(iso: string): string {
  try {
    const diff = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diff / 60_000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
  } catch {
    return '';
  }
}
