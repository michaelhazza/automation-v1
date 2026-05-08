import { useAgentOverview } from '../../hooks/useAgentOverview';
import IdentityCard from './IdentityCard';
import PresenceHero from './PresenceHero';

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
      {/* Cards for Chunks 7, 8 will be inserted here */}
    </div>
  );
}
