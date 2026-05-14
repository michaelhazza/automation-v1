import React from 'react';
import { Link } from 'react-router-dom';

interface EmailConfigSetupCardProps {
  agentId: string;
  subaccountId: string;
}

export function EmailConfigSetupCard({ agentId, subaccountId }: EmailConfigSetupCardProps) {
  return (
    <div className="bg-white rounded-[10px] border border-slate-200 p-5">
      <p className="text-[13px] text-slate-500 mt-0 mb-4">
        Email channel is not configured for this agent.
      </p>
      <Link
        to={`/admin/subaccounts/${subaccountId}/agents/${agentId}/channels/email/setup`}
        className="inline-block px-4 py-2 text-[13px] font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 no-underline"
      >
        Set up email
      </Link>
    </div>
  );
}
