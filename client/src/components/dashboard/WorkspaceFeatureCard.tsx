import React from 'react';
import { Link } from 'react-router-dom';

interface WorkspaceFeatureCardProps {
  title: string;
  href: string;
  summary: React.ReactNode;
  testId?: string;
}

export default function WorkspaceFeatureCard({
  title,
  href,
  summary,
  testId,
}: WorkspaceFeatureCardProps) {
  return (
    <Link
      to={href}
      data-testid={testId}
      className="flex items-center gap-3 bg-white border border-slate-200 rounded-xl p-4 no-underline
        transition-all duration-150 hover:border-indigo-200 hover:shadow-md hover:-translate-y-0.5"
    >
      <div className="flex-1 min-w-0">
        <div className="text-[14px] font-bold text-slate-900 mb-1">{title}</div>
        <div className="text-[13px] text-slate-500">{summary}</div>
      </div>
      <svg
        className="w-4 h-4 text-slate-400 shrink-0"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={2.5}
        aria-hidden="true"
      >
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
      </svg>
    </Link>
  );
}
