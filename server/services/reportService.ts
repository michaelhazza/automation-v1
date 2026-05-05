import { eq, and, isNull, desc } from 'drizzle-orm';
import { db } from '../db/index.js';
import { reports } from '../db/schema/index.js';
import type { Report } from '../db/schema/index.js';
import { emitOrgUpdate } from '../websocket/emitters.js';

export class ReportService {
  /** List reports for an org, newest first. */
  async listReports(orgId: string): Promise<Report[]> {
    return db
      .select()
      .from(reports)
      .where(and(eq(reports.organisationId, orgId), isNull(reports.deletedAt)))
      .orderBy(desc(reports.generatedAt));
  }

  /** Get a single report by ID. */
  async getReport(orgId: string, reportId: string): Promise<Report> {
    const [report] = await db
      .select()
      .from(reports)
      .where(
        and(
          eq(reports.id, reportId),
          eq(reports.organisationId, orgId),
          isNull(reports.deletedAt)
        )
      );

    if (!report) {
      throw { statusCode: 404, message: 'Report not found' };
    }
    return report;
  }

  /** Get the latest completed report for an org. */
  async getLatestReport(orgId: string): Promise<Report | null> {
    const [report] = await db
      .select()
      .from(reports)
      .where(
        and(
          eq(reports.organisationId, orgId),
          eq(reports.status, 'complete'),
          isNull(reports.deletedAt)
        )
      )
      .orderBy(desc(reports.generatedAt))
      .limit(1);

    return report ?? null;
  }

  /** Check whether this org has ever had a completed report. */
  async isFirstReport(orgId: string): Promise<boolean> {
    const [existing] = await db
      .select({ id: reports.id })
      .from(reports)
      .where(
        and(
          eq(reports.organisationId, orgId),
          eq(reports.status, 'complete'),
          isNull(reports.deletedAt)
        )
      )
      .limit(1);

    return !existing;
  }

  /** Create a new report (initially in 'generating' status). */
  async createReport(orgId: string, title: string): Promise<Report> {
    const isFirst = await this.isFirstReport(orgId);

    const [report] = await db
      .insert(reports)
      .values({
        organisationId: orgId,
        title,
        reportType: 'portfolio_health',
        status: 'generating',
        isFirstReport: isFirst,
      })
      .returning();

    return report;
  }

  /** Mark a report as complete with health data and HTML content. */
  async completeReport(
    orgId: string,
    reportId: string,
    data: {
      totalClients: number;
      healthyCount: number;
      attentionCount: number;
      atRiskCount: number;
      htmlContent: string;
    }
  ): Promise<Report> {
    const [report] = await db
      .update(reports)
      .set({
        ...data,
        status: 'complete',
        generatedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(and(eq(reports.id, reportId), eq(reports.organisationId, orgId)))
      .returning();

    if (!report) {
      throw { statusCode: 404, message: 'Report not found' };
    }

    const healthSummary = {
      totalClients: data.totalClients,
      healthy: data.healthyCount,
      attention: data.attentionCount,
      atRisk: data.atRiskCount,
    };

    // Invalidation signal for DashboardPage's refetchClientHealth
    emitOrgUpdate(orgId, 'dashboard.client.health.changed', healthSummary);

    // Merge-in-place update for ClientPulseDashboardPage
    emitOrgUpdate(orgId, 'dashboard:update', healthSummary);

    return report;
  }

  /** Mark a report as failed. */
  async failReport(orgId: string, reportId: string, error?: string): Promise<void> {
    await db
      .update(reports)
      .set({
        status: 'error',
        metadata: error ? { error } : undefined,
        updatedAt: new Date(),
      })
      .where(and(eq(reports.id, reportId), eq(reports.organisationId, orgId)));
  }

  /** Resend a report email. In the full implementation, fetches the org owner email and sends. */
  async resendReport(orgId: string, reportId: string): Promise<void> {
    const report = await this.getReport(orgId, reportId);

    if (report.status !== 'complete') {
      throw { statusCode: 400, message: 'Cannot resend a report that is not complete' };
    }

    // In the full implementation, this would look up the org owner's email
    // and call emailService.sendReportEmail(). For now, log and update timestamp.
    await db
      .update(reports)
      .set({ emailedAt: new Date(), updatedAt: new Date() })
      .where(eq(reports.id, reportId));
  }
}

export const reportService = new ReportService();
