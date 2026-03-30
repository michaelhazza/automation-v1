interface Agent {
  id: string;
  name: string | null;
  slug: string | null;
}

interface TaskCardProps {
  item: {
    id: string;
    title: string;
    priority: string;
    assignedAgents?: Agent[];
    assignedAgent?: Agent | null;
    dueDate?: string | null;
    createdAt: string;
  };
  onClick: () => void;
  provided?: {
    innerRef: (element: HTMLElement | null) => void;
    draggableProps: Record<string, unknown>;
    dragHandleProps: Record<string, unknown> | null;
  };
  isDragging?: boolean;
}

const priorityBg: Record<string, string> = {
  urgent: 'bg-red-500',
  high: 'bg-amber-500',
  normal: 'bg-indigo-500',
  low: 'bg-slate-400',
};

export default function TaskCard({ item, onClick, provided, isDragging }: TaskCardProps) {
  const refProps = provided
    ? { ref: provided.innerRef, ...provided.draggableProps, ...provided.dragHandleProps }
    : {};

  // Prefer the new assignedAgents array; fall back to legacy singular field
  const agents = item.assignedAgents?.length
    ? item.assignedAgents
    : item.assignedAgent
      ? [item.assignedAgent]
      : [];

  const MAX_VISIBLE = 3;
  const visibleAgents = agents.slice(0, MAX_VISIBLE);
  const overflow = agents.length - MAX_VISIBLE;
  const isOverdue = item.dueDate && new Date(item.dueDate) < new Date();

  return (
    <div
      {...refProps}
      onClick={onClick}
      className={`px-3 py-2.5 bg-white border border-slate-200 rounded-lg cursor-pointer transition-[box-shadow,transform] duration-150 flex flex-col gap-1.5 ${
        isDragging
          ? 'shadow-[0_4px_12px_rgba(0,0,0,0.15)] rotate-2'
          : 'shadow-[0_1px_2px_rgba(0,0,0,0.04)]'
      }`}
    >
      <div className="flex items-center gap-1.5">
        <span
          className={`w-2 h-2 rounded-full shrink-0 ${priorityBg[item.priority] ?? 'bg-indigo-500'}`}
        />
        <span className="text-[13px] font-semibold text-slate-800 leading-[1.3] truncate">
          {item.title}
        </span>
      </div>

      <div className="flex items-center justify-between text-[11px] text-slate-400">
        {agents.length > 0 ? (
          <div className="flex items-center gap-1 flex-wrap">
            {visibleAgents.map(a => (
              <span key={a.id} className="bg-slate-100 px-1.5 py-px rounded text-slate-600">
                {a.name}
              </span>
            ))}
            {overflow > 0 && (
              <span className="bg-slate-200 px-1.5 py-px rounded text-slate-500">
                +{overflow}
              </span>
            )}
          </div>
        ) : (
          <span className="italic">Unassigned</span>
        )}
        {item.dueDate && (
          <span className={isOverdue ? 'text-red-500' : 'text-slate-500'}>
            {new Date(item.dueDate).toLocaleDateString()}
          </span>
        )}
      </div>
    </div>
  );
}
