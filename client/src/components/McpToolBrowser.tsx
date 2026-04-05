import Modal from './Modal';

interface McpTool {
  name: string;
  description?: string;
}

interface McpServer {
  id: string;
  name: string;
  slug: string;
  discoveredToolsJson: McpTool[] | null;
}

export default function McpToolBrowser({ server, onClose }: { server: McpServer; onClose: () => void }) {
  const tools = server.discoveredToolsJson ?? [];

  return (
    <Modal title={`${server.name} — Discovered Tools (${tools.length})`} onClose={onClose} maxWidth={560}>
      {tools.length === 0 ? (
        <div className="py-8 text-center text-[14px] text-slate-400">
          No tools discovered. Click "Test" on the server card to discover tools.
        </div>
      ) : (
        <div className="space-y-3 max-h-[60vh] overflow-auto">
          {tools.map((tool) => (
            <div key={tool.name} className="p-3 bg-slate-50 border border-slate-100 rounded-lg">
              <div className="font-semibold text-[13px] text-slate-800">
                <code className="bg-slate-200/60 px-1.5 py-0.5 rounded text-[12px]">mcp.{server.slug}.{tool.name}</code>
              </div>
              {tool.description && (
                <div className="text-[12px] text-slate-500 mt-1 leading-relaxed">{tool.description}</div>
              )}
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}
