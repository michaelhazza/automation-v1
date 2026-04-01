// ---------------------------------------------------------------------------
// MCP HTTP route — Streamable HTTP transport for the MCP server.
//
// Mounted at /mcp. Each request gets a fresh McpServer instance bound to
// the authenticated user's tenant context, keeping session isolation.
//
// Authentication: standard Bearer-token middleware (authenticate).
// Agent context: passed via X-Agent-Id and X-Run-Id headers (optional);
//   falls back to sentinel values so tooling can always connect.
// ---------------------------------------------------------------------------

import { Router, Request, Response } from 'express';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { authenticate } from '../middleware/auth.js';
import { buildMcpServer } from '../mcp/mcpServer.js';

const router = Router();

router.all('/mcp', authenticate, async (req: Request, res: Response) => {
  const user = req.user!;
  const organisationId = req.orgId ?? user.organisationId;

  // Optional headers let an agent run identify itself for audit purposes.
  const agentId  = (req.headers['x-agent-id']  as string | undefined) ?? 'mcp-client';
  const runId    = (req.headers['x-run-id']     as string | undefined) ?? 'mcp-session';

  const server = buildMcpServer({
    runId,
    organisationId,
    subaccountId: (req.headers['x-subaccount-id'] as string | undefined) ?? organisationId,
    agentId,
  });

  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // stateless — no session persistence
  });

  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    console.error('[MCP] Transport error', err);
    if (!res.headersSent) {
      res.status(500).json({ error: 'MCP transport error' });
    }
  }
});

export default router;
