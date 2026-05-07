import React from 'react';

interface MigratedFromGoalsBannerProps { migratedAt: string; }

export default function MigratedFromGoalsBanner({ migratedAt }: MigratedFromGoalsBannerProps) {
  return (
    <div role="status" className="mx-6 mt-4 p-3 bg-blue-50 border border-blue-200 rounded-lg text-sm text-blue-700">
      This project was migrated from Goals on {new Date(migratedAt).toLocaleDateString()}. Some fields may have been reorganized.
    </div>
  );
}
