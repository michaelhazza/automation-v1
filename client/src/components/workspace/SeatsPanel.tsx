import React, { useEffect, useState } from 'react';
import { getSubaccountWorkspaceConfig } from '../../lib/api';

interface SeatUsage { active: number; suspended: number; total: number }

export function SeatsPanel({ subaccountId }: { subaccountId: string }) {
  const [seats, setSeats] = useState<SeatUsage | null>(null);

  useEffect(() => {
    getSubaccountWorkspaceConfig(subaccountId)
      .then((data: { seatUsage: SeatUsage }) => setSeats(data.seatUsage))
      .catch(() => {});
  }, [subaccountId]);

  if (!seats) return null;

  return (
    <div className="text-sm text-gray-600">
      <span className="font-medium">{seats.active}</span> active seat{seats.active !== 1 ? 's' : ''}
      {seats.suspended > 0 && <span className="ml-2 text-amber-600">· {seats.suspended} suspended</span>}
    </div>
  );
}
