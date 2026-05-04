import { useEffect, useRef } from 'react';
import type { TaskProjection } from '../../../../shared/types/taskProjection';
import { MilestoneCard } from './MilestoneCard';
import { ApprovalCard } from './ApprovalCard';
import { ThinkingBox } from './ThinkingBox';
import { AskFormCard } from './AskFormCard';
import { PauseCard } from './PauseCard';

interface ChatPaneProps { taskId: string; projection: TaskProjection }

export function ChatPane({ taskId, projection }: ChatPaneProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [projection.chatMessages.length, projection.milestones.length]);

  const pendingApprovals = projection.approvalGates.filter(g => g.status === 'pending');
  const pendingAsks = projection.askGates.filter(g => g.status === 'pending');

  if (
    projection.chatMessages.length === 0 &&
    projection.milestones.length === 0 &&
    pendingApprovals.length === 0 &&
    pendingAsks.length === 0
  ) {
    return (
      <div className="flex-1 flex items-center justify-center p-8 text-center">
        <div>
          <p className="text-[15px] font-semibold text-slate-600 mb-2">Waiting to begin</p>
          <p className="text-[13px] text-slate-400">
            The agent will post updates here as it works on your task.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
        {projection.milestones.map(m => (
          <MilestoneCard key={m.id} milestone={m} />
        ))}
        {projection.chatMessages.map(msg => (
          <div key={msg.id} className={`flex ${msg.authorKind === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div
              className={`max-w-[80%] px-3 py-2 rounded-lg text-[13px] ${
                msg.authorKind === 'user' ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-800'
              }`}
            >
              {msg.body}
            </div>
          </div>
        ))}
        {pendingApprovals.map(g => (
          <ApprovalCard key={g.gateId} gate={g} taskId={taskId} />
        ))}
        {pendingAsks.map(g => (
          <AskFormCard key={g.gateId} gate={g} taskId={taskId} />
        ))}
        {projection.thinkingText && <ThinkingBox text={projection.thinkingText} />}
        {projection.runStatus?.startsWith('paused') && (
          <PauseCard taskId={taskId} reason={projection.runStatus as 'paused' | 'paused_cost' | 'paused_wall_clock'} />
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
