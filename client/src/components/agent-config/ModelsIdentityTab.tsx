const inputCls = 'w-full px-3 py-2 text-[13px] border border-slate-200 rounded-lg outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 bg-white';
const labelCls = 'block text-[13px] font-medium text-slate-700 mb-1.5';

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-[10px] border border-slate-200 mb-5">
      <div className="px-5 py-4 border-b border-slate-100">
        <h2 className="m-0 text-[15px] font-semibold text-slate-900">{title}</h2>
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}

function PlaceholderRow({ label, badge }: { label: string; badge: string }) {
  return (
    <div className="flex items-center justify-between py-3 opacity-50 cursor-not-allowed select-none border-b border-slate-100 last:border-0">
      <span className="text-[13px] text-slate-600">{label}</span>
      <span className="text-[11px] font-medium text-slate-400 bg-slate-100 px-2 py-1 rounded">{badge}</span>
    </div>
  );
}

export interface ModelsIdentityTabProps {
  modelProvider: string;
  modelId: string;
}

export default function ModelsIdentityTab({ modelProvider, modelId }: ModelsIdentityTabProps) {
  return (
    <div>
      <Section title="Model">
        <div className="space-y-4">
          <div>
            <label className={labelCls}>Model</label>
            <input
              type="text"
              value={`${modelProvider} / ${modelId}`}
              readOnly
              disabled
              className={`${inputCls} bg-slate-50 text-slate-500 cursor-not-allowed`}
            />
            <div className="text-[11px] text-slate-400 mt-1">
              Model is set at the org-level agent. To change it, edit the org-level agent configuration.
            </div>
          </div>
        </div>
      </Section>

      <Section title="Identity and Keys">
        <div>
          <PlaceholderRow label="Operator Session Identity" badge="Phase 3 (coming soon)" />
          <PlaceholderRow label="BYO API Keys" badge="Phase 1.5 (coming soon)" />
        </div>
      </Section>
    </div>
  );
}
