// Amber inline banner shown when the operator session is auto-extending past
// the soft cap (mockup r15). The Pause button is hidden during this state;
// Stop remains available.

export function OperatorAutoExtendBanner() {
  return (
    <div className="flex items-center gap-2 px-4 py-1.5 bg-amber-50 border-b border-amber-200 text-[12px] text-amber-700">
      <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse shrink-0" />
      <span>
        Extending session to reach a safe checkpoint. Stop is still available.
      </span>
    </div>
  );
}
