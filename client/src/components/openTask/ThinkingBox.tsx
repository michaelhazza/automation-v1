interface ThinkingBoxProps { text: string }

export function ThinkingBox({ text }: ThinkingBoxProps) {
  return (
    <div className="flex items-center gap-2 px-3 py-2 text-[13px] italic text-slate-500">
      <span className="w-2 h-2 rounded-full bg-indigo-400 animate-pulse" />
      <span>{text}</span>
    </div>
  );
}
