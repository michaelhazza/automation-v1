import { useEffect, useState } from 'react';
import { SkillPickerSection } from '../SkillPickerSection';
import type { AvailableSkill } from '../SkillPickerSection';
import api from '../../lib/api';
import type { LinkDetail } from './types';

interface SkillsTabProps {
  link: LinkDetail;
  availableSkills: AvailableSkill[];
  onSaved(): Promise<void>;
}

export function SkillsTab({ link, availableSkills, onSaved }: SkillsTabProps) {
  const [skillSlugs, setSkillSlugs] = useState<string[]>(
    link.skillSlugs ?? link.agent.defaultSkillSlugs,
  );
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    setSkillSlugs(link.skillSlugs ?? link.agent.defaultSkillSlugs);
  }, [link]);

  async function save() {
    setSaving(true);
    setSaved(false);
    setSaveError(null);
    try {
      await api.patch(`/api/subaccounts/${link.subaccountId}/agents/${link.id}`, { skillSlugs });
      await onSaved();
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: { message?: string } | string } }; message?: string };
      const apiErr = err.response?.data?.error;
      const msg = typeof apiErr === 'string' ? apiErr : apiErr?.message;
      setSaveError(msg ?? err.message ?? 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      {saveError && (
        <div className="mb-4 px-4 py-2.5 bg-red-50 border border-red-200 rounded-lg text-[13px] text-red-700">{saveError}</div>
      )}
      <div className="text-[13px] text-slate-500 mb-4">
        Override which skills this agent can use in this subaccount.
        {link.agent.defaultSkillSlugs.length > 0 && (
          <span className="ml-1">
            Org defaults: <span className="font-medium text-slate-700">{link.agent.defaultSkillSlugs.join(', ')}</span>
          </span>
        )}
      </div>
      <SkillPickerSection
        selectedSlugs={skillSlugs}
        availableSkills={availableSkills}
        onChange={setSkillSlugs}
      />
      <div className="flex items-center gap-3 mt-2">
        <button
          onClick={save}
          disabled={saving}
          className="btn btn-primary disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save Skills'}
        </button>
        {saved && <span className="text-[13px] text-green-600 font-medium">Saved</span>}
      </div>
    </div>
  );
}
