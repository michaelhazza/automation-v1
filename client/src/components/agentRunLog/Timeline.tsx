import type { AgentExecutionEvent } from '../../../../shared/types/agentExecutionLog';
import EventRow from './EventRow';

interface Props {
  events: AgentExecutionEvent[];
  onOpen: (event: AgentExecutionEvent) => void;
}

export default function Timeline({ events, onOpen }: Props) {
  if (events.length === 0) {
    return (
      <div className="text-sm text-slate-500 p-6 text-center">
        No events yet. The timeline will populate as the run executes.
      </div>
    );
  }
  return (
    <ol className="space-y-2">
      {events.map((e) => (
        <li key={e.id}>
          <EventRow event={e} onOpen={onOpen} />
        </li>
      ))}
    </ol>
  );
}
