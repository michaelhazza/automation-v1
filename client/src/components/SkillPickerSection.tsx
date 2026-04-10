import { useState, useEffect } from 'react';

export interface AvailableSkill {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  skillType: 'built_in' | 'custom';
}

export function SkillPickerSection({
  selectedSlugs,
  availableSkills,
  onChange,
}: {
  selectedSlugs: string[];
  availableSkills: AvailableSkill[];
  onChange: (slugs: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [draft, setDraft] = useState<string[]>([]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open]);

  const openDialog = () => {
    setDraft([...selectedSlugs]);
    setSearch('');
    setOpen(true);
  };

  const toggleDraft = (slug: string) => {
    setDraft(prev => prev.includes(slug) ? prev.filter(s => s !== slug) : [...prev, slug]);
  };

  const filtered = availableSkills.filter(s => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return s.name.toLowerCase().includes(q) || s.slug.toLowerCase().includes(q) || (s.description ?? '').toLowerCase().includes(q);
  });

  const selectedSkills = availableSkills.filter(s => selectedSlugs.includes(s.slug));
  const draftSkills = availableSkills.filter(s => draft.includes(s.slug));

  return (
    <>
      <div className="bg-white rounded-[10px] border border-slate-200 mb-5">
        <div className="px-5 py-4 border-b border-slate-100 flex justify-between items-center">
          <div>
            <h2 className="m-0 text-[15px] font-semibold text-slate-900 inline">Skills</h2>
            {selectedSlugs.length > 0 && (
              <span className="ml-2 text-xs font-medium text-slate-500 bg-slate-100 px-2 py-[2px] rounded-full">
                {selectedSlugs.length}
              </span>
            )}
            <div className="text-xs text-slate-500 mt-1">Capabilities this agent can use as tools.</div>
          </div>
          <button
            onClick={openDialog}
            className="flex items-center gap-1.5 text-xs font-medium bg-indigo-600 text-white px-3 py-1.5 rounded-lg hover:bg-indigo-700 transition-colors border-0 cursor-pointer font-[inherit]"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            Link Skills
          </button>
        </div>
        <div className="p-5">
          {selectedSkills.length === 0 ? (
            <div className="text-center py-5 text-slate-500 text-[13px]">
              No skills linked.{' '}
              <button onClick={openDialog} className="text-indigo-500 bg-transparent border-0 cursor-pointer font-[inherit] text-[13px] p-0">Link one</button>
            </div>
          ) : (
            <div className="flex flex-col gap-1.5">
              {selectedSkills.map(skill => (
                <div key={skill.slug} className="flex items-center justify-between px-3.5 py-2.5 rounded-[8px] bg-slate-50 border border-slate-200">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-[13px] font-medium text-slate-900 shrink-0">{skill.name}</span>
                    <span className={`text-[10px] font-semibold px-1.5 py-[1px] rounded-full shrink-0 ${
                      skill.skillType === 'built_in' ? 'bg-violet-100 text-violet-700' : 'bg-blue-100 text-blue-700'
                    }`}>
                      {skill.skillType === 'built_in' ? 'Built-in' : 'Custom'}
                    </span>
                    {skill.description && (
                      <span className="text-[11px] text-slate-400 truncate hidden sm:block">{skill.description}</span>
                    )}
                  </div>
                  <button
                    onClick={() => onChange(selectedSlugs.filter(s => s !== skill.slug))}
                    className="shrink-0 ml-3 text-slate-400 hover:text-red-500 transition-colors bg-transparent border-0 cursor-pointer p-1 rounded"
                    title="Remove skill"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.4)' }}>
          <div className="bg-white rounded-[12px] shadow-2xl w-full max-w-lg flex flex-col" style={{ maxHeight: '85vh' }}>
            <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between shrink-0">
              <h3 className="m-0 text-[15px] font-semibold text-slate-900">Link Skills</h3>
              <button onClick={() => setOpen(false)} className="text-slate-400 hover:text-slate-600 bg-transparent border-0 cursor-pointer p-1">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>

            <div className="px-4 py-3 border-b border-slate-100 shrink-0">
              <input
                autoFocus
                type="text"
                placeholder="Search skills…"
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="w-full px-3 py-2 text-[13px] border border-slate-200 rounded-lg outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
              />
            </div>

            <div className="overflow-y-auto flex-1 px-4 py-2">
              {filtered.length === 0 ? (
                <div className="text-center py-8 text-slate-400 text-[13px]">No skills match "{search}"</div>
              ) : (
                filtered.map(skill => {
                  const checked = draft.includes(skill.slug);
                  return (
                    <button
                      key={skill.slug}
                      onClick={() => toggleDraft(skill.slug)}
                      className="w-full flex items-start gap-3 px-3 py-2.5 rounded-[8px] hover:bg-slate-50 cursor-pointer text-left font-[inherit] border-0 bg-transparent transition-colors"
                    >
                      <div className={`rounded-[4px] shrink-0 mt-[1px] border-2 flex items-center justify-center transition-all ${
                        checked ? 'bg-indigo-500 border-indigo-500' : 'bg-white border-gray-300'
                      }`} style={{ width: 18, height: 18 }}>
                        {checked && (
                          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span className="text-[13px] font-medium text-slate-900">{skill.name}</span>
                          <span className={`text-[10px] font-semibold px-1.5 py-[1px] rounded-full ${
                            skill.skillType === 'built_in' ? 'bg-violet-100 text-violet-700' : 'bg-blue-100 text-blue-700'
                          }`}>
                            {skill.skillType === 'built_in' ? 'Built-in' : 'Custom'}
                          </span>
                        </div>
                        {skill.description && (
                          <div className="text-[11px] text-slate-400 mt-0.5 line-clamp-1">{skill.description}</div>
                        )}
                      </div>
                    </button>
                  );
                })
              )}
            </div>

            <div className="px-4 py-3 border-t border-slate-100 bg-slate-50 shrink-0">
              {draftSkills.length === 0 ? (
                <div className="text-[12px] text-slate-400">No skills selected</div>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {draftSkills.map(s => (
                    <span key={s.slug} className="flex items-center gap-1 text-[11px] font-medium bg-indigo-100 text-indigo-700 px-2 py-[3px] rounded-full">
                      {s.name}
                      <button
                        onClick={e => { e.stopPropagation(); toggleDraft(s.slug); }}
                        className="text-indigo-400 hover:text-indigo-700 bg-transparent border-0 cursor-pointer p-0 leading-none"
                      >×</button>
                    </span>
                  ))}
                </div>
              )}
            </div>

            <div className="px-4 py-3 border-t border-slate-100 flex justify-end gap-2 shrink-0">
              <button
                onClick={() => setOpen(false)}
                className="px-4 py-2 text-[13px] font-medium text-slate-600 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 cursor-pointer font-[inherit]"
              >
                Cancel
              </button>
              <button
                onClick={() => { onChange(draft); setOpen(false); }}
                className="px-4 py-2 text-[13px] font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 cursor-pointer font-[inherit] border-0"
              >
                Done{draftSkills.length > 0 ? ` (${draftSkills.length})` : ''}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
