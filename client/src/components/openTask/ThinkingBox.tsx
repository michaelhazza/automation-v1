/**
 * ThinkingBox — pulsing dot + plain-language thinking text.
 *
 * Spec: docs/workflows-dev-spec.md §9.2 (thinking box).
 * Shows at the bottom of the chat scroll area, above the composer.
 */

interface ThinkingBoxProps {
  text: string | null;
}

export default function ThinkingBox({ text }: ThinkingBoxProps) {
  if (!text) return null;

  return (
    <div className="flex items-center gap-2 px-4 py-2 border-t border-slate-700/50 bg-slate-800/30">
      {/* Pulsing indigo dot */}
      <span
        className="shrink-0 w-2 h-2 rounded-full bg-indigo-400 [animation:pulse_1.5s_ease-in-out_infinite]"
        aria-hidden="true"
      />
      <p className="text-[13px] italic text-slate-400 truncate">{text}</p>
    </div>
  );
}
