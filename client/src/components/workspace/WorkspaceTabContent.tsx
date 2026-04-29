import React, { useState } from 'react';
import { SeatsPanel } from './SeatsPanel';

export function WorkspaceTabContent({ subaccountId }: { subaccountId: string }) {
  const [selectedBackend, setSelectedBackend] = useState<'synthetos_native' | null>(null);

  return (
    <div className="space-y-6">
      <h2 className="text-lg font-semibold">Workspace</h2>
      <div className="grid grid-cols-2 gap-4">
        <button
          onClick={() => setSelectedBackend('synthetos_native')}
          className={`p-4 border-2 rounded-lg text-left transition-colors ${selectedBackend === 'synthetos_native' ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:border-gray-300'}`}
        >
          <div className="font-medium text-sm">Synthetos native</div>
          <div className="text-xs text-gray-500 mt-1">Built-in email and calendar for agents</div>
        </button>
        <div className="p-4 border-2 border-gray-100 rounded-lg text-left opacity-50 cursor-not-allowed" title="Coming in the next phase">
          <div className="font-medium text-sm">Google Workspace</div>
          <div className="text-xs text-gray-500 mt-1">Connect to your Google Workspace tenant</div>
        </div>
      </div>
      <SeatsPanel subaccountId={subaccountId} />
    </div>
  );
}
