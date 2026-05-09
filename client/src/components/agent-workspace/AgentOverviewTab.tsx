import { useAgentOverview } from '../../hooks/useAgentOverview';
import IdentityCard from './IdentityCard';
import PresenceHero from './PresenceHero';
import RecentObservationsCard from './RecentObservationsCard';
import KnowledgeInUseCard from './KnowledgeInUseCard';
import FilesSnapshotCard from './FilesSnapshotCard';
import ActiveGoalsCard from './ActiveGoalsCard';
import ToolsUsageBandsCard from './ToolsUsageBandsCard';
import ConnectionsHealthCard from './ConnectionsHealthCard';
import SchedulePeekCard from './SchedulePeekCard';
import WorkingTimeChart from './WorkingTimeChart';
import ActivityFeedCard from './ActivityFeedCard';
import FirstRunOverview from './FirstRunOverview';

interface Props {
  agentId: string;
}

export default function AgentOverviewTab({ agentId }: Props) {
  const { data, isLoading, isError } = useAgentOverview(agentId);

  if (isLoading) {
    return <div className="py-8 text-center text-slate-400 text-sm">Loading...</div>;
  }
  if (isError || !data) {
    return <div className="py-8 text-center text-red-500 text-sm">Failed to load overview.</div>;
  }

  // First-run = no completed runs yet (server-authoritative). An agent with a
  // run in progress but no observations / activity yet is NOT first-run — the
  // live presence surface must render so the operator can watch the active run.
  const isFirstRun = !data.hasCompletedRuns;

  if (isFirstRun) {
    return (
      <FirstRunOverview
        agentId={agentId}
        identity={{
          id: data.identity.id,
          name: data.identity.name,
          role: data.identity.role,
        }}
      />
    );
  }

  return (
    <div className="space-y-4">
      <IdentityCard identity={data.identity} />
      <PresenceHero presence={data.presence} agentId={agentId} />
      {data.activeGoals.length > 0 && (
        <ActiveGoalsCard goals={data.activeGoals} agentId={agentId} />
      )}
      <RecentObservationsCard observations={data.recentObservations} agentId={agentId} />
      <KnowledgeInUseCard entries={data.knowledgeInUse} agentId={agentId} />
      <FilesSnapshotCard files={data.filesSnapshot} agentId={agentId} />
      <WorkingTimeChart agentId={agentId} />
      <ActivityFeedCard feed={data.activityFeed} agentId={agentId} />
      <ToolsUsageBandsCard bands={data.toolsUsageBands} />
      <ConnectionsHealthCard connections={data.connectionsHealth} agentId={agentId} />
      <SchedulePeekCard schedulePeek={data.schedulePeek} />
    </div>
  );
}
