/**
 * SkeletonLoader — reusable shimmer placeholders for loading states.
 *
 * Three variants:
 *   card        — fixed-height card block (default h-[88px])
 *   table-row   — horizontal row with avatar + two lines of text
 *   text-block  — stacked lines of text (title + 3 body lines)
 *
 * Usage:
 *   <SkeletonLoader variant="card" count={4} />
 *   <SkeletonLoader variant="table-row" count={6} />
 *   <SkeletonLoader variant="text-block" />
 */

const shimmer =
  'bg-[linear-gradient(90deg,#f1f5f9_25%,#e2e8f0_50%,#f1f5f9_75%)] bg-[length:400%_100%] animate-[shimmer_1.4s_ease-in-out_infinite] rounded-md';

interface SkeletonLoaderProps {
  variant?: 'card' | 'table-row' | 'text-block';
  count?: number;
  className?: string;
  /** Override height for the card variant (Tailwind height class, e.g. "h-52") */
  cardHeight?: string;
}

function CardSkeleton({ height = 'h-[88px]' }: { height?: string }) {
  return <div className={`${height} rounded-xl ${shimmer}`} />;
}

function TableRowSkeleton() {
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <div className={`w-8 h-8 rounded-full shrink-0 ${shimmer}`} />
      <div className="flex-1 flex flex-col gap-1.5">
        <div className={`h-3.5 w-1/3 ${shimmer}`} />
        <div className={`h-3 w-1/2 ${shimmer}`} />
      </div>
      <div className={`h-3 w-16 ${shimmer}`} />
    </div>
  );
}

function TextBlockSkeleton() {
  return (
    <div className="flex flex-col gap-2.5">
      <div className={`h-5 w-40 ${shimmer}`} />
      <div className={`h-3.5 w-full ${shimmer}`} />
      <div className={`h-3.5 w-5/6 ${shimmer}`} />
      <div className={`h-3.5 w-3/4 ${shimmer}`} />
    </div>
  );
}

export default function SkeletonLoader({
  variant = 'card',
  count = 1,
  className = '',
  cardHeight,
}: SkeletonLoaderProps) {
  const items = Array.from({ length: count }, (_, i) => i);

  if (variant === 'card') {
    return (
      <div className={`grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(200px,1fr))] ${className}`}>
        {items.map((i) => (
          <CardSkeleton key={i} height={cardHeight} />
        ))}
      </div>
    );
  }

  if (variant === 'table-row') {
    return (
      <div className={`flex flex-col divide-y divide-slate-100 ${className}`}>
        {items.map((i) => (
          <TableRowSkeleton key={i} />
        ))}
      </div>
    );
  }

  // text-block
  return (
    <div className={`flex flex-col gap-6 ${className}`}>
      {items.map((i) => (
        <TextBlockSkeleton key={i} />
      ))}
    </div>
  );
}

/** Convenience: a full-page skeleton matching the DashboardPage layout */
export function DashboardSkeleton() {
  return (
    <div className="flex flex-col gap-5">
      <div className={`h-9 w-64 ${shimmer}`} />
      <SkeletonLoader variant="card" count={4} />
      <div className={`h-52 rounded-xl ${shimmer}`} />
      <div className={`h-48 rounded-xl ${shimmer}`} />
    </div>
  );
}

/** Convenience: a table-page skeleton (header + rows) */
export function TablePageSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="flex flex-col gap-4">
      <div className={`h-9 w-48 ${shimmer}`} />
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className={`h-11 ${shimmer} rounded-none`} />
        <SkeletonLoader variant="table-row" count={rows} />
      </div>
    </div>
  );
}
