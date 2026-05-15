const ROLE_CLS: Record<string, string> = {
  ceo: 'bg-amber-100 text-amber-800',
  orchestrator: 'bg-purple-100 text-purple-800',
  specialist: 'bg-blue-100 text-blue-800',
  worker: 'bg-slate-100 text-slate-700',
};

export function RoleBadge({ role }: { role: string | null }) {
  if (!role) return null;
  return (
    <span className={`inline-block px-2 py-0.5 rounded-full text-[11px] font-medium capitalize ${ROLE_CLS[role] ?? 'bg-slate-100 text-slate-600'}`}>
      {role}
    </span>
  );
}
