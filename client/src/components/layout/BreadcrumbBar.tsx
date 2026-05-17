import { Link } from 'react-router-dom';

interface BreadcrumbBarProps {
  items: { label: string; to: string }[];
}

export function BreadcrumbBar({ items }: BreadcrumbBarProps) {
  if (items.length === 0) {
    return <span className="text-slate-900 font-semibold">Home</span>;
  }
  return (
    <>
      {items.map((crumb, i) => (
        <span key={i} className="flex items-center gap-1.5">
          {i > 0 && <span className="text-slate-300">›</span>}
          {i === items.length - 1
            ? <span className="text-slate-900 font-semibold">{crumb.label}</span>
            : <Link to={crumb.to} className="text-slate-500 no-underline hover:text-indigo-500 transition-colors duration-100">{crumb.label}</Link>
          }
        </span>
      ))}
    </>
  );
}
