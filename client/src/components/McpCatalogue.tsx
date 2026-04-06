import { useState, useEffect } from 'react';
import api from '../lib/api';
import Modal from './Modal';

interface McpPreset {
  slug: string;
  name: string;
  description: string;
  category: string;
  transport: string;
  requiresConnection: boolean;
  credentialProvider?: string;
  recommendedGateLevel: string;
  toolCount: number;
  toolHighlights: string[];
  setupNotes?: string;
  isAdded: boolean;
}

export default function McpCatalogue({ onAdded }: { onAdded: () => void }) {
  const [presets, setPresets] = useState<McpPreset[]>([]);
  const [categories, setCategories] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('');
  const [addPreset, setAddPreset] = useState<McpPreset | null>(null);
  const [addForm, setAddForm] = useState({ defaultGateLevel: 'auto', envVars: '' });
  const [addError, setAddError] = useState('');
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    api.get('/api/mcp-presets').then(({ data }) => {
      setPresets(data.presets);
      setCategories(data.categories);
    }).finally(() => setLoading(false));
  }, []);

  const filtered = filter
    ? presets.filter(p => p.name.toLowerCase().includes(filter.toLowerCase()) || p.description.toLowerCase().includes(filter.toLowerCase()))
    : presets;

  const grouped = Object.entries(categories).map(([key, label]) => ({
    key,
    label,
    presets: filtered.filter(p => p.category === key),
  })).filter(g => g.presets.length > 0);

  const handleAdd = (preset: McpPreset) => {
    setAddPreset(preset);
    setAddForm({ defaultGateLevel: preset.recommendedGateLevel, envVars: '' });
    setAddError('');
  };

  const handleAddSubmit = async () => {
    if (!addPreset) return;
    setAdding(true);
    setAddError('');
    try {
      await api.post('/api/mcp-servers', {
        presetSlug: addPreset.slug,
        defaultGateLevel: addForm.defaultGateLevel,
        envVars: addForm.envVars || undefined,
      });
      setAddPreset(null);
      onAdded();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string } } };
      setAddError(e.response?.data?.message ?? 'Failed to add integration');
    } finally {
      setAdding(false);
    }
  };

  const inputCls = 'block w-full mt-1 px-3 py-2 border border-slate-200 rounded-lg text-[13px] bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500';

  if (loading) return <div className="py-20 text-center text-sm text-slate-400">Loading catalogue...</div>;

  return (
    <div>
      {/* Search */}
      <div className="mb-6">
        <input
          type="text"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Search integrations..."
          className="w-full max-w-sm px-4 py-2.5 border border-slate-200 rounded-lg text-[13px] bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
      </div>

      {grouped.length === 0 && (
        <div className="py-12 text-center text-[14px] text-slate-400">No integrations match your search.</div>
      )}

      {grouped.map(({ key, label, presets: groupPresets }) => (
        <div key={key} className="mb-8">
          <h2 className="text-[16px] font-bold text-slate-700 mb-3">{label}</h2>
          <div className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(300px,1fr))]">
            {groupPresets.map((preset) => (
              <div key={preset.slug} className="bg-white border border-slate-200 rounded-xl p-5">
                <div className="flex justify-between items-start mb-2">
                  <div className="font-bold text-[15px] text-slate-800">{preset.name}</div>
                  <span className="text-[11px] text-slate-400 whitespace-nowrap">{preset.toolCount} tools</span>
                </div>
                <p className="text-[13px] text-slate-500 leading-relaxed mb-3">{preset.description}</p>

                {/* Tool highlights */}
                <div className="flex flex-wrap gap-1 mb-3">
                  {preset.toolHighlights.slice(0, 4).map(t => (
                    <code key={t} className="text-[10px] bg-slate-100 px-1.5 py-0.5 rounded text-slate-500">{t}</code>
                  ))}
                  {preset.toolHighlights.length > 4 && (
                    <span className="text-[10px] text-slate-400">+{preset.toolHighlights.length - 4} more</span>
                  )}
                </div>

                {/* Credential requirement */}
                <div className="text-[12px] text-slate-400 mb-3">
                  {preset.requiresConnection
                    ? `Requires: ${preset.credentialProvider} connection`
                    : preset.setupNotes?.includes('API_KEY') ? 'Requires: API key in env' : 'No credentials needed'}
                </div>

                {preset.isAdded ? (
                  <span className="inline-block px-3 py-1.5 bg-slate-100 text-slate-500 rounded-lg text-[12px] font-medium">Already added</span>
                ) : (
                  <button
                    onClick={() => handleAdd(preset)}
                    className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-[12px] font-semibold border-0 cursor-pointer transition-colors"
                  >
                    + Add to Org
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      ))}

      {/* Add modal */}
      {addPreset && (
        <Modal title={`Add ${addPreset.name}`} onClose={() => setAddPreset(null)} maxWidth={480}>
          {addError && <div className="mb-4 p-3 bg-red-50 text-red-700 text-[13px] rounded-lg">{addError}</div>}

          <p className="text-[13px] text-slate-500 leading-relaxed mb-1">{addPreset.description}</p>
          <div className="flex flex-wrap gap-1 mb-4">
            {addPreset.toolHighlights.map(t => (
              <code key={t} className="text-[10px] bg-slate-100 px-1.5 py-0.5 rounded text-slate-500">{t}</code>
            ))}
          </div>

          {/* Setup notes */}
          {addPreset.setupNotes && (
            <div className="mb-4 p-3 bg-blue-50 border border-blue-100 rounded-lg text-[13px] text-blue-800 leading-relaxed">
              {addPreset.setupNotes}
            </div>
          )}

          {/* Env vars */}
          <label className="block text-[13px] font-semibold text-slate-700 mb-4">
            Environment Variables (optional, KEY=VALUE per line)
            <textarea
              value={addForm.envVars}
              onChange={(e) => setAddForm({ ...addForm, envVars: e.target.value })}
              rows={3}
              className={inputCls}
              placeholder="BRAVE_API_KEY=your-key-here"
            />
            <span className="text-[11px] text-slate-400 mt-1 block">Values are encrypted at rest. Only needed if the server requires config beyond OAuth.</span>
          </label>

          {/* Gate level */}
          <label className="block text-[13px] font-semibold text-slate-700 mb-6">
            Default Gate Level
            <select
              value={addForm.defaultGateLevel}
              onChange={(e) => setAddForm({ ...addForm, defaultGateLevel: e.target.value })}
              className={inputCls}
            >
              <option value="auto">Auto — execute immediately</option>
              <option value="review">Review — require human approval{addPreset.recommendedGateLevel === 'review' ? ' (recommended)' : ''}</option>
              <option value="block">Block — deny all tool calls</option>
            </select>
          </label>

          <div className="flex gap-2.5 justify-end">
            <button onClick={() => setAddPreset(null)} className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-[13px] font-semibold border-0 cursor-pointer transition-colors">Cancel</button>
            <button
              onClick={handleAddSubmit}
              disabled={adding}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-[13px] font-semibold border-0 cursor-pointer transition-colors disabled:opacity-50"
            >
              {adding ? 'Adding...' : 'Add Integration'}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
