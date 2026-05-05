import React from 'react';
import { EmailConfigSetupCard } from './EmailConfigSetupCard';
import { EmailConfigEditor, type AgentEmailConfig } from './EmailConfigEditor';

interface EmailChannelTileAgent {
  id: string;
  subaccountId: string;
  channels?: string[];
  emailConfig?: AgentEmailConfig | null;
}

interface EmailChannelTileProps {
  agent: EmailChannelTileAgent;
}

export function EmailChannelTile({ agent }: EmailChannelTileProps) {
  if (!agent.channels?.includes('email')) return null;
  if (!agent.emailConfig) {
    return <EmailConfigSetupCard agentId={agent.id} subaccountId={agent.subaccountId} />;
  }
  return <EmailConfigEditor config={agent.emailConfig} agentId={agent.id} />;
}
