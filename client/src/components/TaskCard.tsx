interface TaskCardProps {
  item: {
    id: string;
    title: string;
    priority: string;
    assignedAgent?: { id: string; name: string; slug: string } | null;
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

  return (
    <div
      {...refProps}
      onClick={onClick}
      style={{
        padding: '8px 10px',
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
        {item.assignedAgent ? (
          <span style={{ background: '#f1f5f9', padding: '1px 6px', borderRadius: 4, color: '#475569' }}>
            {item.assignedAgent.name}
          </span>
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
