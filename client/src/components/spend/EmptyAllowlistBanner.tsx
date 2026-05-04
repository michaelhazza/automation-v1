interface EmptyAllowlistBannerProps {
  onLoadDefaults: () => void;
}

/**
 * Prominent banner shown on Spending Budget create/detail when merchant_allowlist is empty.
 * Copy is locked per spec §14. Persists until the allowlist has at least one entry.
 */
export default function EmptyAllowlistBanner({ onLoadDefaults }: EmptyAllowlistBannerProps) {
  return (
    <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 flex items-start gap-3">
      <svg
        width={18}
        height={18}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="shrink-0 text-amber-600 mt-0.5"
      >
        <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
        <line x1="12" y1="9" x2="12" y2="13" />
        <line x1="12" y1="17" x2="12.01" y2="17" />
      </svg>
      <div className="flex-1 min-w-0">
        <p className="text-[13px] font-semibold text-amber-800 mb-1">Empty allowlist</p>
        <p className="text-[12.5px] text-amber-700 leading-relaxed">
          Every charge will block. Click{' '}
          <button
            onClick={onLoadDefaults}
            className="underline font-semibold text-amber-800 hover:text-amber-900 border-none bg-transparent cursor-pointer p-0 [font-family:inherit] text-[12.5px]"
          >
            Load conservative defaults
          </button>{' '}
          to populate working values, or add merchants manually.
        </p>
      </div>
    </div>
  );
}
