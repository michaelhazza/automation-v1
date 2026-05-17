import { attachmentIcon } from './format';

export function AttachmentTypeIcon({ type }: { type: string }) {
  const label = attachmentIcon(type);
  const bgCls =
    label === 'img'
      ? 'bg-emerald-100 text-emerald-700'
      : label === 'pdf'
        ? 'bg-red-100 text-red-700'
        : label === 'txt'
          ? 'bg-sky-100 text-sky-700'
          : 'bg-slate-100 text-slate-600';
  return (
    <span className={`inline-flex items-center justify-center w-8 h-8 rounded-lg text-[10px] font-bold uppercase shrink-0 ${bgCls}`}>
      {label}
    </span>
  );
}
