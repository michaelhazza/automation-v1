interface BandProps {
  label: string;
  tools: string[];
}

function Band({ label, tools }: BandProps) {
  if (tools.length === 0) return null;
  return (
    <div className="mb-3 last:mb-0">
      <p className="text-xs font-medium text-slate-500 mb-1.5">{label}</p>
      <div className="flex flex-wrap gap-1.5">
        {tools.map(tool => (
          <span
            key={tool}
            className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-slate-100 text-slate-600"
          >
            {tool}
          </span>
        ))}
      </div>
    </div>
  );
}

interface Props {
  bands: {
    frequently: string[];
    occasionally: string[];
    rarely: string[];
    asOf: string;
  };
}

export default function ToolsUsageBandsCard({ bands }: Props) {
  const hasAny = bands.frequently.length > 0 || bands.occasionally.length > 0 || bands.rarely.length > 0;

  return (
    <div className="bg-white rounded-lg border border-slate-100 p-4">
      <h4 className="text-sm font-semibold text-slate-700 mb-3">Tools Used</h4>
      {!hasAny ? (
        <p className="text-xs text-slate-400 text-center py-4">No tool usage recorded yet.</p>
      ) : (
        <>
          <Band label="Frequently" tools={bands.frequently} />
          <Band label="Occasionally" tools={bands.occasionally} />
          <Band label="Rarely" tools={bands.rarely} />
        </>
      )}
    </div>
  );
}
