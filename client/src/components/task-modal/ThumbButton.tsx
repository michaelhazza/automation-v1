export function ThumbButton({ direction, filled, onClick }: { direction: 'up' | 'down'; filled: boolean; onClick: () => void }) {
  const isUp = direction === 'up';
  return (
    <button
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      className={`bg-transparent border-0 cursor-pointer p-0.5 rounded transition-colors ${
        filled
          ? isUp ? 'text-green-600' : 'text-red-500'
          : 'text-slate-300 hover:text-slate-500'
      }`}
      title={isUp ? 'Thumbs up' : 'Thumbs down'}
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        {isUp ? (
          <path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3H14zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3" />
        ) : (
          <path d="M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3H10zM17 2h2.67A2.31 2.31 0 0 1 22 4v7a2.31 2.31 0 0 1-2.33 2H17" />
        )}
      </svg>
    </button>
  );
}
