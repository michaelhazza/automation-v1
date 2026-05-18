import { useState } from 'react';
import { useListPendingAmendments } from '../../hooks/useSkillAmendments.js';
import { AmendmentRow } from './AmendmentRow.js';
import { AmendmentReviewDrawer } from './AmendmentReviewDrawer.js';

interface Props {
  subaccountId: string;
}

export function AmendmentSection({ subaccountId }: Props) {
  const { items, loading, refetch } = useListPendingAmendments(subaccountId);
  const [openId, setOpenId] = useState<string | null>(null);

  // Don't render the section at all while loading or when empty
  if (loading || items.length === 0) return null;

  // Sort by blast radius (high first), then by createdAt ascending
  const BLAST_ORDER: Record<string, number> = { high: 0, medium: 1, low: 2 };
  const sorted = [...items].sort((a, b) => {
    const blastDiff = (BLAST_ORDER[a.blastRadiusEstimate] ?? 1) - (BLAST_ORDER[b.blastRadiusEstimate] ?? 1);
    if (blastDiff !== 0) return blastDiff;
    return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
  });

  return (
    <>
      <div className="mt-7 border-t border-slate-200 pt-5">
        <div className="flex items-center justify-between mb-3.5">
          <div className="flex items-center gap-2">
            <span className="text-[15px] font-bold text-slate-900">Proposed Amendments</span>
            <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-violet-50 text-violet-700 text-[11.5px] font-bold">
              {items.length}
            </span>
          </div>
          <span className="text-[12.5px] text-slate-400">
            Your agent proposed these based on recent runs.
          </span>
        </div>

        {sorted.map((item) => (
          <AmendmentRow
            key={item.id}
            item={item}
            onClick={() => setOpenId(item.id)}
          />
        ))}
      </div>

      {openId && (
        <AmendmentReviewDrawer
          subaccountId={subaccountId}
          amendmentId={openId}
          onClose={() => setOpenId(null)}
          onActioned={() => {
            setOpenId(null);
            refetch();
          }}
        />
      )}
    </>
  );
}
