export function Step1Connect({ onConnected }: { onConnected: () => void }) {
  return (
    <div className="text-center">
      <div className="w-16 h-16 rounded-2xl bg-orange-100 flex items-center justify-center mx-auto mb-5">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#f97316" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
          <polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>
        </svg>
      </div>
      <h2 className="text-2xl font-bold text-slate-900 mb-3">Connect Go High Level</h2>
      <p className="text-slate-500 text-[14px] mb-7 max-w-sm mx-auto leading-relaxed">
        Link your GHL agency account so ClientPulse can monitor your clients. Read-only access — we never modify your data.
      </p>
      <a
        href="/onboarding/connect-ghl"
        className="inline-flex items-center gap-2.5 px-6 py-3.5 bg-orange-500 hover:bg-orange-600 text-white text-[15px] font-semibold rounded-xl transition-colors shadow-sm no-underline"
      >
        Connect Go High Level →
      </a>
      <div className="mt-4">
        <button
          onClick={onConnected}
          className="text-[13px] text-slate-400 hover:text-slate-600 bg-transparent border-0 cursor-pointer"
        >
          Already connected? Skip →
        </button>
      </div>
    </div>
  );
}
