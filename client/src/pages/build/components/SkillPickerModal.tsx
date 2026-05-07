import React, { useState, useEffect } from 'react';
import Modal from '../../../components/Modal';
import { SearchBox } from '../../../components/SearchBox';
import type { SkillBindingPayload } from '../../../../../shared/types/build';
import api from '../../../lib/api';

interface SkillEntry {
  id: string;
  name: string;
  slug: string;
  description: string | null;
}

interface SkillPickerModalProps {
  onSelect: (skill: SkillBindingPayload) => void;
  onClose: () => void;
  existingIds: string[];
}

export function SkillPickerModal({ onSelect, onClose, existingIds }: SkillPickerModalProps) {
  const [q, setQ] = useState('');
  const [skills, setSkills] = useState<SkillEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api.get<SkillEntry[]>('/api/skills')
      .then(({ data }) => { if (!cancelled) { setSkills(data); setLoading(false); } })
      .catch(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const filtered = skills.filter(s =>
    !existingIds.includes(s.id) &&
    (q === '' || s.name.toLowerCase().includes(q.toLowerCase()))
  );

  return (
    <Modal title="Add skill" onClose={onClose} maxWidth={600}>
      <SearchBox value={q} onChange={setQ} placeholder="Search skills..." autoFocus />
      {loading ? (
        <p className="text-sm text-slate-400 mt-4 text-center">Loading...</p>
      ) : filtered.length === 0 ? (
        <p className="text-sm text-slate-400 mt-4 text-center">
          {q ? 'No skills match your search.' : 'No skills available to add.'}
        </p>
      ) : (
        <ul className="mt-3 divide-y divide-slate-100 max-h-80 overflow-y-auto">
          {filtered.map(skill => (
            <li key={skill.id}>
              <button
                className="w-full text-left px-3 py-2.5 hover:bg-slate-50 transition-colors"
                onClick={() => onSelect({ id: skill.id, key: skill.slug, name: skill.name, status: 'enabled' })}
              >
                <span className="text-sm font-medium text-slate-800">{skill.name}</span>
                {skill.description && (
                  <span className="block text-xs text-slate-500 mt-0.5 truncate">{skill.description}</span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
