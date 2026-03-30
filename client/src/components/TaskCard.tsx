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

const priorityColours: Record<string, string> = {
  urgent: '#ef4444',
  high: '#f59e0b',
  normal: '#6366f1',
  low: '#94a3b8',
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

  return (
    <div
      {...refProps}
      onClick={onClick}
      style={{
        padding: '10px 12px',
        background: '#fff',
        border: '1px solid #e2e8f0',
        borderRadius: 8,
        cursor: 'pointer',
        boxShadow: isDragging ? '0 4px 12px rgba(0,0,0,0.15)' : '0 1px 2px rgba(0,0,0,0.04)',
        transform: isDragging ? 'rotate(2deg)' : 'none',
        transition: 'box-shadow 0.15s, transform 0.15s',
        display: 'flex',
        flexDirection: 'column' as const,
        gap: 6,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span
          style={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            background: priorityColours[item.priority] ?? '#6366f1',
            flexShrink: 0,
          }}
        />
        <span style={{ fontSize: 13, fontWeight: 600, color: '#1e293b', lineHeight: '1.3', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }}>
          {item.title}
        </span>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 11, color: '#94a3b8' }}>
        {agents.length > 0 ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' as const }}>
            {visibleAgents.map(a => (
              <span
                key={a.id}
                style={{ background: '#f1f5f9', padding: '1px 6px', borderRadius: 4, color: '#475569' }}
              >
                {a.name}
              </span>
            ))}
            {overflow > 0 && (
              <span style={{ background: '#e2e8f0', padding: '1px 6px', borderRadius: 4, color: '#64748b' }}>
                +{overflow}
              </span>
            )}
          </div>
        ) : (
          <span style={{ fontStyle: 'italic' }}>Unassigned</span>
        )}
        {item.dueDate && (
          <span style={{ color: new Date(item.dueDate) < new Date() ? '#ef4444' : '#64748b' }}>
            {new Date(item.dueDate).toLocaleDateString()}
          </span>
        )}
      </div>
    </div>
  );
}
