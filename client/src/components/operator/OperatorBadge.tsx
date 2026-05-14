// Small badge rendered on TaskCard when the task is running under the
// operator_managed backend (mockup r12).

export function OperatorBadge() {
  return (
    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-indigo-50 text-indigo-600 border border-indigo-200">
      <span className="w-1.5 h-1.5 rounded-full bg-indigo-400" />
      Operator
    </span>
  );
}
