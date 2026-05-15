// ---------------------------------------------------------------------------
// Page infrastructure skill handlers
// Slugs: create_page, update_page, publish_page
// ---------------------------------------------------------------------------

import type { SkillExecutionContext } from '../context.js';

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

export async function executeCreatePage(
  input: Record<string, unknown>,
  context: SkillExecutionContext
): Promise<unknown> {
  const projectId = String(input.projectId ?? '');
  const slug = String(input.slug ?? '');
  const pageType = String(input.pageType ?? 'website') as 'website' | 'landing';
  if (!projectId || !slug) return { success: false, error: 'projectId and slug are required' };

  const { pageProjectService } = await import('../../pageProjectService.js');
  const { pageService } = await import('../../pageService.js');

  const project = await pageProjectService.getById(projectId, context.subaccountId!, context.organisationId);
  if (!project) return { success: false, error: 'Page project not found' };

  const page = await pageService.create(
    {
      projectId,
      slug,
      pageType,
      title: input.title ? String(input.title) : undefined,
      html: input.html ? String(input.html) : '',
      meta: (input.meta as Record<string, unknown>) ?? undefined,
      formConfig: (input.formConfig as Record<string, unknown>) ?? undefined,
      createdByAgentId: context.agentId,
    },
    project.slug
  );

  return { success: true, pageId: page.id, previewUrl: page.previewUrl, status: 'draft' };
}

export async function executeUpdatePage(
  input: Record<string, unknown>,
  context: SkillExecutionContext
): Promise<unknown> {
  const pageId = String(input.pageId ?? '');
  const projectId = String(input.projectId ?? '');
  if (!pageId || !projectId) return { success: false, error: 'pageId and projectId are required' };

  const { pageProjectService } = await import('../../pageProjectService.js');
  const { pageService } = await import('../../pageService.js');

  const project = await pageProjectService.getById(projectId, context.subaccountId!, context.organisationId);
  if (!project) return { success: false, error: 'Page project not found' };

  const result = await pageService.update(
    pageId,
    projectId,
    {
      html: input.html ? String(input.html) : undefined,
      meta: input.meta as Record<string, unknown> | undefined,
      formConfig: input.formConfig as Record<string, unknown> | undefined,
      changeNote: input.changeNote ? String(input.changeNote) : undefined,
    },
    project.slug
  );

  return { success: true, pageId: result.id, previewUrl: result.previewUrl };
}

export async function executePublishPage(
  input: Record<string, unknown>,
  context: SkillExecutionContext
): Promise<unknown> {
  const pageId = String(input.pageId ?? '');
  const projectId = String(input.projectId ?? '');
  if (!pageId || !projectId) return { success: false, error: 'pageId and projectId are required' };

  const { pageProjectService } = await import('../../pageProjectService.js');
  const { pageService } = await import('../../pageService.js');

  const project = await pageProjectService.getById(projectId, context.subaccountId!, context.organisationId);
  if (!project) return { success: false, error: 'Page project not found or access denied' };

  const page = await pageService.publish(pageId, projectId);

  return { success: true, pageId: page.id, status: page.status, publishedAt: page.publishedAt };
}
