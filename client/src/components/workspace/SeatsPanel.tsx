import React, { useEffect, useState } from 'react';
import { getSubaccountWorkspaceConfig } from '../../lib/api';

interface SeatUsage {
  active: number;
  suspended: number;
  total: number;
  billingSnapshot: number | null;
  lastSnapshotAt: string | null;
}

const STALE_THRESHOLD_MS = 70 * 60 * 1000; // 70 minutes per D-Inv-5

export function SeatsPanel({ subaccountId }: { subaccountId: string }) {
  const [seats, setSeats] = useState<SeatUsage | null>(null);

  useEffect(() => {
    getSubaccountWorkspaceConfig(subaccountId)
      .then((data: { seatUsage: SeatUsage }) => setSeats(data.seatUsage))
      .catch(() => {});
  }, [subaccountId]);

  if (!seats) return null;

  const snapshotDiffers =
    seats.billingSnapshot !== null && seats.active !== seats.billingSnapshot;

  const isStale =
    seats.lastSnapshotAt !== null &&
    Date.now() - new Date(seats.lastSnapshotAt).getTime() > STALE_THRESHOLD_MS;

  return (
    <div className="text-sm text-gray-600">
      <div>
        <span className="font-medium">{seats.active}</span> active seat{seats.active !== 1 ? 's' : ''}
        {seats.suspended > 0 && (
          <span className="ml-2 text-amber-600">· {seats.suspended} suspended</span>
        )}
        {snapshotDiffers && (
          <span className="ml-2 text-gray-400">
            · billing snapshot: {seats.billingSnapshot}
          </span>
        )}
      </div>
      {seats.lastSnapshotAt && (
        <div className="mt-0.5 text-xs text-gray-400">
          last updated: {new Date(seats.lastSnapshotAt).toLocaleString()}
          {isStale && (
            <span className="ml-1 text-amber-500">· billing snapshot may be stale</span>
          )}
        </div>
      )}
    </div>
  );
}
