import React from 'react';

interface AgentVersionChipProps {
  count: number;
  editedAt: string | null;
  author: string | null;
}

export default function AgentVersionChip({ count, editedAt, author }: AgentVersionChipProps) {
  const label = `v${Math.max(1, count)}`;
  const tooltipParts = [
    editedAt && `Last edited ${new Date(editedAt).toLocaleDateString()}`,
    author && `by ${author}`,
  ].filter(Boolean).join(' ');

  return (
    <span
      title={tooltipParts || undefined}
      className="inline-flex items-center px-1.5 py-0.5 text-[10px] font-semibold rounded bg-slate-100 text-slate-500 cursor-default"
    >
      {label}
    </span>
  );
}
