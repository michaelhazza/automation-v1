// ---------------------------------------------------------------------------
// MCP HTTP route — Streamable HTTP transport for the MCP server.
//
// Mounted at /mcp. Each request gets a fresh McpServer instance bound to
// the authenticated user's tenant context, keeping session isolation.
//
// Authentication: standard Bearer-token middleware (authenticate).
// Agent context: passed via X-Agent-Id and X-Run-Id headers (optional);
//   falls back to sentinel values so tooling can always connect.
//
// Tool filtering: if X-Agent-Id and X-Subaccount-Id are provided, the
//   subaccount agent's allowedSkillSlugs are applied so MCP clients only
//   see tools the agent is allowed to use.
// ---------------------------------------------------------------------------

import { Router, Request, Response } from 'express';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { authenticate } from '../middleware/auth.js';
import { buildMcpServer } from '../mcp/mcpServer.js';
import { db } from '../db/index.js';
import { subaccountAgents } from '../db/schema/index.js';
import { eq, and } from 'drizzle-orm';
import { logger } from '../lib/logger.js';

const router = Router();

router.all('/mcp', authenticate, async (req: Request, res: Response) => {
  const user = req.user!;
  const organisationId = req.orgId ?? user.organisationId;

  // Optional headers let an agent run identify itself for audit purposes.
  const agentId      = (req.headers['x-agent-id']       as string | undefined) ?? 'mcp-client';
  const runId        = (req.headers['x-run-id']          as string | undefined) ?? 'mcp-session';
  const subaccountId = (req.headers['x-subaccount-id']   as string | undefined) ?? organisationId;

  // ── Resolve tool allowlist from subaccount agent config ──────────────
  let allowedSkillSlugs: string[] | null = null;

  if (agentId !== 'mcp-client' && subaccountId !== organisationId) {
    try {
      const [saLink] = await db
        .select({ allowedSkillSlugs: subaccountAgents.allowedSkillSlugs })
        .from(subaccountAgents)
        .where(
          and(
            eq(subaccountAgents.agentId, agentId),
            eq(subaccountAgents.subaccountId, subaccountId),
          )
        )
        .limit(1);

      if (saLink?.allowedSkillSlugs) {
        allowedSkillSlugs = saLink.allowedSkillSlugs as string[];
      }
    } catch {
      // If lookup fails (e.g. invalid UUID), proceed without filtering
    }
  }

  const server = await buildMcpServer({
    runId,
    organisationId,
    subaccountId,
    agentId,
    allowedSkillSlugs,
  });

  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // stateless — no session persistence
  });

  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    logger.error('mcp.transport_error', { error: err instanceof Error ? err.message : String(err) });
    if (!res.headersSent) {
      res.status(500).json({ error: 'MCP transport error' });
    }
  }
});

export default router;
