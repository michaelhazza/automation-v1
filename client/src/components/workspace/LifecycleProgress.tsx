import React from 'react';
import type { WorkspaceIdentityStatus } from '../../../../shared/types/workspace';

const STATUS_CONFIG: Record<WorkspaceIdentityStatus, { dot: string; label: string }> = {
  provisioned: { dot: 'bg-yellow-400', label: 'Provisioning' },
  active:      { dot: 'bg-green-500',  label: 'Active' },
  suspended:   { dot: 'bg-amber-400',  label: 'Suspended' },
  revoked:     { dot: 'bg-red-500',    label: 'Revoked' },
  archived:    { dot: 'bg-gray-400',   label: 'Archived' },
};

export function LifecycleProgress({ status }: { status: WorkspaceIdentityStatus }) {
  const config = STATUS_CONFIG[status] ?? { dot: 'bg-gray-400', label: status };
  return (
    <span className="inline-flex items-center gap-1.5 text-sm">
      <span className={`inline-block w-2 h-2 rounded-full ${config.dot}`} />
      <span className="text-gray-700">{config.label}</span>
    </span>
  );
}
