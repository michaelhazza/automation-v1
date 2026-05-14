interface IdentityProps {
  name: string;
  role: string;
  reportsTo: string | null;
  subaccountId: string | null;
}

interface Props {
  identity: IdentityProps;
}

export default function IdentityCard({ identity }: Props) {
  return (
    <div className="bg-white rounded-lg border border-slate-100 p-4">
      <h3 className="text-base font-semibold text-slate-900">{identity.name}</h3>
      {identity.role && (
        <p className="text-sm text-slate-500 mt-0.5">{identity.role}</p>
      )}
      {identity.reportsTo && (
        <p className="text-xs text-slate-400 mt-1">Reports to: {identity.reportsTo}</p>
      )}
    </div>
  );
}
