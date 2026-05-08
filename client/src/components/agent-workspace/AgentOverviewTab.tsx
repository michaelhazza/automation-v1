import { useAgentOverview } from '../../hooks/useAgentOverview';
import IdentityCard from './IdentityCard';
import PresenceHero from './PresenceHero';
import RecentObservationsCard from './RecentObservationsCard';
import KnowledgeInUseCard from './KnowledgeInUseCard';
import FilesSnapshotCard from './FilesSnapshotCard';

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

  return (
    <div className="space-y-4">
      <IdentityCard identity={data.identity} />
      <PresenceHero presence={data.presence} agentId={agentId} />
      <RecentObservationsCard observations={data.recentObservations} agentId={agentId} />
      <KnowledgeInUseCard entries={data.knowledgeInUse} agentId={agentId} />
      <FilesSnapshotCard files={data.filesSnapshot} agentId={agentId} />
    </div>
  );
}
