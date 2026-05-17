import { eq, and, isNull, isNotNull, count, sql, desc } from 'drizzle-orm';
import { getOrgScopedDb } from '../../lib/orgScopedDb.js';
import { agents } from '../../db/schema/agents.js';
import { systemAgents } from '../../db/schema/systemAgents.js';
import { actions } from '../../db/schema/actions.js';
import { agentRuns } from '../../db/schema/agentRuns.js';
import type { HomeWidgetDeclaration, HomeWidget, SummaryCardData } from '../../../shared/types/homeWidget.js';
import { orderAgents, resolveTitleTemplate } from './homeWidgetServicePure.js';
import type { AgentForWidget } from './homeWidgetServicePure.js';

interface AgentWidgetRow extends AgentForWidget {
  homeWidget: HomeWidgetDeclaration | null;
}

export const homeWidgetService = {
  async getWidgets({
    userId,
    organisationId,
  }: {
    userId: string;
    subaccountId: string;
    organisationId: string;
  }): Promise<HomeWidget[]> {
    const scopedDb = getOrgScopedDb('homeWidgetService.getWidgets');
    const rows = await scopedDb
      .select({
        id: agents.id,
        name: agents.name,
        createdAt: agents.createdAt,
        homeWidget: systemAgents.homeWidget,
      })
      .from(agents)
      .innerJoin(
        systemAgents,
        and(
          eq(agents.systemAgentId, systemAgents.id),
          isNotNull(systemAgents.homeWidget),
        ),
      )
      .where(
        and(
          eq(agents.ownerUserId, userId),
          eq(agents.organisationId, organisationId),
          isNull(agents.deletedAt),
        ),
      );

    const sorted = orderAgents(rows as AgentWidgetRow[]) as AgentWidgetRow[];

    const results: HomeWidget[] = [];

    for (const row of sorted) {
      try {
        const declaration = row.homeWidget!;

        if (declaration.bodyProviderSkill === 'ea.home_widget.summary') {
          const [countRow] = await scopedDb
            .select({ total: count() })
            .from(actions)
            .where(
              and(
                eq(actions.agentId, row.id),
                eq(actions.status, 'pending_approval'),
                sql`${actions.metadataJson}->>'kind' = 'ea_draft'`,
              ),
            );

          const draftCount = Number(countRow?.total ?? 0);

          const [latestRun] = await scopedDb
            .select({ startedAt: agentRuns.startedAt })
            .from(agentRuns)
            .where(
              and(
                eq(agentRuns.agentId, row.id),
                sql`${agentRuns.triggerContext}->>'eventType' = 'daily_briefing'`,
              ),
            )
            .orderBy(desc(agentRuns.startedAt))
            .limit(1);

          const latestBriefingLine = latestRun?.startedAt
            ? `Last briefing: ${latestRun.startedAt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
            : 'No briefing yet';

          const data: SummaryCardData = {
            widgetType: 'summary_card',
            title: resolveTitleTemplate(declaration.titleTemplate, { displayName: row.name }),
            summary: `${draftCount} pending approval · ${latestBriefingLine}`,
            updatedAt: new Date().toISOString(),
          };

          results.push({
            agentId: row.id,
            agentName: row.name,
            declaration,
            data,
            fetchedAt: new Date().toISOString(),
          });
        } else {
          const data: SummaryCardData = {
            widgetType: 'summary_card',
            title: resolveTitleTemplate(declaration.titleTemplate, { displayName: row.name }),
            summary: '',
            updatedAt: new Date().toISOString(),
          };

          results.push({
            agentId: row.id,
            agentName: row.name,
            declaration,
            data,
            fetchedAt: new Date().toISOString(),
          });
        }
      } catch {
        // On error, include the widget with null data so the client can show a
        // degraded state rather than silently dropping the widget.
        results.push({
          agentId: row.id,
          agentName: row.name,
          declaration: row.homeWidget!,
          data: null,
          fetchedAt: null,
        });
      }
    }

    return results;
  },
};
