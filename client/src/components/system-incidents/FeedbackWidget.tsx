// Feedback widget for agent-diagnosed resolved incidents (spec §10.4).
// Visible only when: status=resolved, agentDiagnosis is set, promptWasUseful is null.
// Three states: idle → submitting → done/error.
import { useState } from 'react';
import api from '../../lib/api';

type Usefulness = 'yes' | 'no' | 'partial';

interface Props {
  incidentId: string;
  status: string;
  agentDiagnosis: Record<string, unknown> | null;
  promptWasUseful: boolean | null;
  onFeedbackSaved: () => void;
}

export default function FeedbackWidget({
  incidentId,
  status,
  agentDiagnosis,
  promptWasUseful,
  onFeedbackSaved,
}: Props) {
  const [skipped, setSkipped] = useState(false);
  const [selection, setSelection] = useState<Usefulness | null>(null);
  const [text, setText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Only show for resolved incidents with a diagnosis and no feedback yet
  if (status !== 'resolved' || agentDiagnosis === null || promptWasUseful !== null) {
    // Show summary if feedback already recorded
    if (status === 'resolved' && agentDiagnosis !== null && promptWasUseful !== null) {
      return (
        <div className="text-[12px] text-slate-500 italic">
          Operator marked this {promptWasUseful ? 'useful' : 'not useful'}.
        </div>
      );
    }
    return null;
  }

  if (skipped) return null;

  if (done) {
    return <div className="text-[12px] text-slate-500 italic">Thanks — feedback saved.</div>;
  }

  const submit = async () => {
    if (!selection) return;
    setSubmitting(true);
    setError(null);
    try {
      await api.post(`/api/system/incidents/${incidentId}/feedback`, {
        wasSuccessful: selection,
        text: text.trim() || undefined,
      });
      setDone(true);
      onFeedbackSaved();
    } catch (e: any) {
      setError(e?.response?.data?.error?.message ?? 'Failed to save feedback');
    } finally {
      setSubmitting(false);
    }
  };

  const RADIO_OPTIONS: Array<{ value: Usefulness; label: string }> = [
    { value: 'yes', label: 'Yes — it pointed me at the right place' },
    { value: 'no', label: 'No — I had to investigate from scratch' },
    { value: 'partial', label: 'Partially — useful but missed something' },
  ];

  return (
    <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-[12px]">
      <div className="font-semibold text-slate-700 mb-2">Was the agent's diagnosis useful?</div>
      <div className="space-y-1.5 mb-3">
        {RADIO_OPTIONS.map(({ value, label }) => (
          <label key={value} className="flex items-start gap-2 cursor-pointer">
            <input
              type="radio"
              name={`feedback-${incidentId}`}
              value={value}
              checked={selection === value}
              onChange={() => setSelection(value)}
              className="mt-0.5"
            />
            <span className="text-slate-700">{label}</span>
          </label>
        ))}
      </div>
      <div className="mb-3">
        <label className="block text-slate-500 mb-1">What did it get right or wrong? (optional)</label>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value.slice(0, 2000))}
          rows={3}
          maxLength={2000}
          className="w-full text-[12px] border border-slate-300 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-indigo-500 resize-none"
        />
        {text.length > 1800 && (
          <div className="text-slate-400 text-[10px] text-right">{text.length}/2000</div>
        )}
      </div>
      {error && <div className="text-red-600 text-[11px] mb-2">{error}</div>}
      <div className="flex gap-2">
        <button
          onClick={submit}
          disabled={!selection || submitting}
          className="px-3 py-1.5 text-[12px] font-medium bg-indigo-600 text-white rounded hover:bg-indigo-700 disabled:opacity-40"
        >
          {submitting ? 'Saving…' : 'Submit'}
        </button>
        <button
          onClick={() => setSkipped(true)}
          className="px-3 py-1.5 text-[12px] text-slate-600 hover:text-slate-800"
        >
          Skip
        </button>
      </div>
    </div>
  );
}
