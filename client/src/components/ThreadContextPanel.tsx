import React from 'react';
import type { ThreadContextReadModel, ThreadContextTask, ThreadContextDecision } from '../../../shared/types/conversationThreadContext';

interface Props {
  readModel: ThreadContextReadModel | null;
  isLive: boolean;  // true when a run is active for this conversation
}

function TaskStatusDot({ status, isLive }: { status: ThreadContextTask['status']; isLive: boolean }) {
  if (status === 'done') {
    return (
      <span className="w-4 h-4 rounded-full bg-green-500 flex items-center justify-center shrink-0">
        <svg width="9" height="9" viewBox="0 0 12 12" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="2 6 5 9 10 3" />
        </svg>
      </span>
    );
  }
  if (status === 'in_progress') {
    return (
      <span className={`w-4 h-4 rounded-full bg-indigo-500 shrink-0 ${isLive ? 'animate-pulse' : ''}`} />
    );
  }
  // pending
  return <span className="w-4 h-4 rounded-full border-2 border-slate-300 bg-white shrink-0" />;
}

function TaskRow({ task, isLive }: { task: ThreadContextTask; isLive: boolean }) {
  return (
    <div className="flex items-start gap-2 py-1.5">
      <TaskStatusDot status={task.status} isLive={isLive} />
      <span className={`text-[13px] leading-snug ${task.status === 'done' ? 'text-slate-400 line-through' : 'text-slate-700'}`}>
        {task.label}
      </span>
    </div>
  );
}

function SectionHeader({ title }: { title: string }) {
  return (
    <div className="text-[10.5px] font-bold text-slate-400 uppercase tracking-wider mb-2">
      {title}
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <p className="text-[12.5px] text-slate-400 italic py-1">{message}</p>
  );
}

export default function ThreadContextPanel({ readModel, isLive }: Props) {
  if (!readModel) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-slate-200 border-t-indigo-600 rounded-full animate-spin" />
      </div>
    );
  }

  const rawTasks = readModel.rawTasks ?? [];
  const rawDecisions = readModel.rawDecisions ?? [];

  // Tasks: completed first (by completedAt desc), then pending/in_progress (by addedAt asc)
  const completedTasks = rawTasks
    .filter((t) => t.status === 'done')
    .sort((a, b) => {
      const aTime = a.completedAt ? new Date(a.completedAt).getTime() : 0;
      const bTime = b.completedAt ? new Date(b.completedAt).getTime() : 0;
      return bTime - aTime; // desc
    });

  const openTasks = rawTasks
    .filter((t) => t.status !== 'done')
    .sort((a, b) => new Date(a.addedAt).getTime() - new Date(b.addedAt).getTime()); // asc

  const sortedTasks: ThreadContextTask[] = [...completedTasks, ...openTasks];

  return (
    <div className="flex flex-col gap-4 p-4 overflow-y-auto">
      {/* Tasks */}
      <div className="bg-white rounded-xl border border-slate-200 px-4 py-3.5">
        <SectionHeader title="Tasks" />
        {sortedTasks.length === 0 ? (
          <EmptyState message="No tasks yet" />
        ) : (
          <div className="divide-y divide-slate-50">
            {sortedTasks.map((task) => (
              <TaskRow key={task.id} task={task} isLive={isLive} />
            ))}
          </div>
        )}
      </div>

      {/* Approach */}
      <div className="bg-white rounded-xl border border-slate-200 px-4 py-3.5">
        <SectionHeader title="Approach" />
        {readModel.approach ? (
          <p className="text-[13px] text-slate-700 leading-relaxed whitespace-pre-wrap">
            {readModel.approach}
          </p>
        ) : (
          <EmptyState message="No approach defined" />
        )}
      </div>

      {/* Decisions */}
      <div className="bg-white rounded-xl border border-slate-200 px-4 py-3.5">
        <SectionHeader title="Decisions" />
        {rawDecisions.length === 0 ? (
          <EmptyState message="No decisions yet" />
        ) : (
          <div className="flex flex-col gap-3">
            {rawDecisions.map((d: ThreadContextDecision) => (
              <div key={d.id}>
                <div className="text-[13px] font-semibold text-slate-800 leading-snug mb-0.5">
                  {d.decision}
                </div>
                {d.rationale && (
                  <div className="text-[12px] text-slate-500 leading-snug">
                    {d.rationale}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Version footer */}
      {readModel.version > 0 && (
        <div className="text-[11px] text-slate-400 text-right px-1">
          v{readModel.version} · {new Date(readModel.updatedAt).toLocaleString()}
        </div>
      )}
    </div>
  );
}
