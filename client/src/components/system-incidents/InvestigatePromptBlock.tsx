// Renders the investigate_prompt block in the incident detail drawer (spec §10.2).
// Shows nothing if investigatePrompt is null (not-yet-triaged or rate-limited).
// Displays the prompt text with a copy button.
import { useState } from 'react';

interface Props {
  investigatePrompt: string | null;
}

export default function InvestigatePromptBlock({ investigatePrompt }: Props) {
  const [copied, setCopied] = useState(false);

  if (!investigatePrompt) return null;

  const copy = () => {
    navigator.clipboard.writeText(investigatePrompt).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => {/* clipboard unavailable */});
  };

  return (
    <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[12px] font-semibold text-slate-700">Investigate prompt</span>
        <button
          onClick={copy}
          className="text-[11px] text-indigo-600 hover:text-indigo-800 font-medium"
        >
          {copied ? 'Copied!' : 'Copy'}
        </button>
      </div>
      <pre className="text-[11px] text-slate-700 whitespace-pre-wrap break-words bg-white rounded border border-slate-100 p-2 overflow-x-auto max-h-48">
        {investigatePrompt}
      </pre>
    </div>
  );
}
