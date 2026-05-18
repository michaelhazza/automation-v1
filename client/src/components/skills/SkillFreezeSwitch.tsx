import { useState, useCallback } from 'react';
import type { FreezeRow, FreezeMutations } from '../../hooks/useSkillAmendmentFreezes.js';

interface SkillFreezeSwitchProps {
  skillId: string;
  freezes: FreezeRow[];
  mutations: FreezeMutations;
}

export function SkillFreezeSwitch({ skillId, freezes, mutations }: SkillFreezeSwitchProps) {
  const [busy, setBusy] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const activeFreezeForSkill = freezes.find(
    (f) =>
      f.freezeType === 'proposal_generation' &&
      f.scope === 'skill' &&
      f.scopeId === skillId &&
      f.thawedAt === null,
  ) ?? null;

  const isPaused = activeFreezeForSkill !== null;

  const showToast = useCallback((msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3500);
  }, []);

  const handleToggle = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      if (isPaused && activeFreezeForSkill) {
        await mutations.thaw(activeFreezeForSkill.id);
      } else {
        await mutations.create({
          scope: 'skill',
          scopeId: skillId,
          freezeType: 'proposal_generation',
          reason: 'operator_paused',
        });
      }
    } catch (err: unknown) {
      const status = (err as { response?: { status?: number } }).response?.status;
      if (status === 409) {
        showToast(
          isPaused
            ? 'Freeze already removed'
            : 'A freeze of this type already exists for this scope',
        );
      }
    } finally {
      setBusy(false);
    }
  }, [busy, isPaused, activeFreezeForSkill, mutations, skillId, showToast]);

  return (
    <div className="relative">
      <div className="flex items-center justify-between px-3.5 py-3 bg-white border border-slate-200 rounded-lg">
        <div>
          <div className="text-[13px] font-semibold text-slate-700">
            Pause new suggestions for this skill
          </div>
          <div className="text-[12px] text-slate-500 mt-0.5">
            {isPaused
              ? 'New suggestions paused. The agent will not propose changes for this skill.'
              : 'The agent will continue suggesting improvements for this skill.'}
          </div>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={isPaused}
          disabled={busy}
          onClick={handleToggle}
          className={`relative shrink-0 w-10 h-[22px] rounded-full transition-colors ml-3 border-0 cursor-pointer disabled:cursor-not-allowed ${isPaused ? 'bg-slate-300' : 'bg-slate-200'}`}
        >
          <span
            className={`absolute top-[3px] left-[3px] w-4 h-4 rounded-full bg-white shadow-sm transition-transform ${isPaused ? 'translate-x-[18px]' : ''}`}
          />
        </button>
      </div>
      {toastMessage && (
        <div className="absolute right-0 top-full mt-1.5 px-3 py-2 bg-slate-800 text-white text-[12px] rounded-lg shadow-lg z-10 whitespace-nowrap">
          {toastMessage}
        </div>
      )}
    </div>
  );
}
