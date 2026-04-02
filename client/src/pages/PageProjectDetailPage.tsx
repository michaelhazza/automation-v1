import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import api from '../lib/api';
import { User, getActiveClientId } from '../lib/auth';

interface PageProject {
  id: string;
  name: string;
  slug: string;
  theme: { primaryColor?: string } | null;
  customDomain: string | null;
  createdAt: string;
}

interface Page {
  id: string;
  slug: string;
  pageType: 'website' | 'landing';
  title: string | null;
  status: 'draft' | 'published' | 'archived';
  html: string | null;
  meta: { title?: string; description?: string } | null;
  formConfig: unknown;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

// Matches PAGES_BASE_DOMAIN on the backend. Change here if the domain changes.
const PAGES_BASE_DOMAIN = 'synthetos.ai';

const STATUS_CLS: Record<string, string> = {
  draft: 'bg-amber-100 text-amber-800',
  published: 'bg-green-100 text-green-800',
  archived: 'bg-slate-100 text-slate-600',
};

const PAGE_TYPE_CLS: Record<string, string> = {
  website: 'bg-blue-100 text-blue-700',
  landing: 'bg-purple-100 text-purple-700',
};

function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function getPageUrl(projectSlug: string, pageSlug: string, pageType: 'website' | 'landing'): string {
  if (pageType === 'landing') {
    return `https://${pageSlug}--${projectSlug}.${PAGES_BASE_DOMAIN}`;
  }
  return `https://${projectSlug}.${PAGES_BASE_DOMAIN}/${pageSlug}`;
}

const inputCls = 'w-full px-3 py-2 border border-slate-200 rounded-lg text-[13px] bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500';

export default function PageProjectDetailPage({ user: _user }: { user: User }) {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const clientId = getActiveClientId();

  const [project, setProject] = useState<PageProject | null>(null);
  const [pages, setPages] = useState<Page[]>([]);
  const [loading, setLoading] = useState(true);

  // New page form state
  const [showNewForm, setShowNewForm] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newSlug, setNewSlug] = useState('');
  const [slugManuallyEdited, setSlugManuallyEdited] = useState(false);
  const [newPageType, setNewPageType] = useState<'website' | 'landing'>('website');
  const [creating, setCreating] = useState(false);

  const [publishingId, setPublishingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!projectId || !clientId) return;
    setLoading(true);
    Promise.all([
      api.get(`/api/subaccounts/${clientId}/page-projects/${projectId}`),
      api.get(`/api/subaccounts/${clientId}/page-projects/${projectId}/pages`),
    ])
      .then(([projRes, pagesRes]) => {
        setProject(projRes.data);
        setPages(pagesRes.data);
      })
      .catch((err) => {
        console.error('[PageProjectDetail] Failed to load:', err);
        navigate(`/admin/subaccounts/${clientId}/page-projects`);
      })
      .finally(() => setLoading(false));
  }, [projectId, clientId]);

  const handleCreatePage = async () => {
    if (!newTitle.trim() || !newSlug.trim() || !projectId || !clientId) return;
    setCreating(true);
    try {
      const { data } = await api.post(`/api/subaccounts/${clientId}/page-projects/${projectId}/pages`, {
        title: newTitle.trim(),
        slug: newSlug.trim(),
        pageType: newPageType,
      });
      setPages((prev) => [data, ...prev]);
      setShowNewForm(false);
      setNewTitle('');
      setNewSlug('');
      setSlugManuallyEdited(false);
      setNewPageType('website');
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: { message?: string }; message?: string } } })?.response?.data?.error?.message
        ?? (err as { response?: { data?: { message?: string } } })?.response?.data?.message
        ?? 'Failed to create page';
      setError(msg);
    } finally {
      setCreating(false);
    }
  };

  const handlePublish = async (pageId: string) => {
    if (!projectId || !clientId) return;
    setPublishingId(pageId);
    try {
      const { data } = await api.post(`/api/subaccounts/${clientId}/page-projects/${projectId}/pages/${pageId}/publish`);
      setPages((prev) => prev.map((p) => (p.id === pageId ? data : p)));
    } catch {
      setError('Failed to publish page');
    } finally {
      setPublishingId(null);
    }
  };

  const handleTitleChange = (value: string) => {
    setNewTitle(value);
    if (!slugManuallyEdited) {
      setNewSlug(slugify(value));
    }
  };

  const hasPublishedPages = pages.some((p) => p.status === 'published');

  if (loading) return <div className="p-12 text-center text-sm text-slate-500">Loading...</div>;
  if (!project) return <div className="p-12 text-center text-sm text-slate-500">Page project not found</div>;

  const subdomainUrl = `https://${project.slug}.${PAGES_BASE_DOMAIN}`;

  return (
    <div className="animate-[fadeIn_0.2s_ease-out_both] max-w-3xl">
      {/* Back link */}
      <button
        onClick={() => navigate(`/admin/subaccounts/${clientId}/page-projects`)}
        className="text-[13px] text-slate-500 hover:text-slate-700 mb-4 cursor-pointer bg-transparent border-0 p-0 transition-colors"
      >
        &larr; Back to Page Projects
      </button>

      {error && (
        <div className="mb-4 px-4 py-3 bg-red-50 border border-red-200 rounded-lg text-[13px] text-red-700 flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="text-red-400 hover:text-red-600 bg-transparent border-0 cursor-pointer text-[16px] leading-none">&times;</button>
        </div>
      )}

      {/* Header */}
      <div className="mb-6">
        <h1 className="text-[24px] font-bold text-slate-900 m-0">{project.name}</h1>
        {hasPublishedPages ? (
          <a
            href={subdomainUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[13px] text-indigo-600 hover:text-indigo-700 mt-1 inline-block"
          >
            {project.slug}.{PAGES_BASE_DOMAIN}
          </a>
        ) : (
          <div className="text-[13px] text-slate-400 mt-1">
            {project.slug}.{PAGES_BASE_DOMAIN}
          </div>
        )}
      </div>

      {/* Pages section */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
          <h2 className="text-[14px] font-semibold text-slate-700 m-0">Pages ({pages.length})</h2>
          <button
            onClick={() => setShowNewForm(true)}
            className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-[12px] font-semibold rounded-lg transition-colors cursor-pointer border-0"
          >
            + New Page
          </button>
        </div>

        {/* Inline create form */}
        {showNewForm && (
          <div className="px-5 py-4 border-b border-slate-200 bg-slate-50/50">
            <div className="flex flex-col gap-3">
              <input
                className={inputCls}
                placeholder="Page title"
                value={newTitle}
                onChange={(e) => handleTitleChange(e.target.value)}
                autoFocus
              />
              <input
                className={inputCls}
                placeholder="Slug"
                value={newSlug}
                onChange={(e) => {
                  setNewSlug(e.target.value);
                  setSlugManuallyEdited(true);
                }}
              />
              <div>
                <div className="text-[12px] text-slate-500 font-medium mb-2">Page type</div>
                <div className="flex gap-2">
                  {(['website', 'landing'] as const).map((type) => (
                    <button
                      key={type}
                      onClick={() => setNewPageType(type)}
                      className={`px-3.5 py-1.5 rounded-lg border text-[12px] font-semibold cursor-pointer transition-colors capitalize ${
                        newPageType === type
                          ? 'border-indigo-500 bg-indigo-50 text-indigo-600'
                          : 'border-slate-200 bg-white text-slate-500 hover:bg-slate-50'
                      }`}
                    >
                      {type}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={handleCreatePage}
                  disabled={!newTitle.trim() || !newSlug.trim() || creating}
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-[13px] font-semibold rounded-lg transition-colors cursor-pointer border-0"
                >
                  {creating ? 'Creating...' : 'Create Page'}
                </button>
                <button
                  onClick={() => {
                    setShowNewForm(false);
                    setNewTitle('');
                    setNewSlug('');
                    setSlugManuallyEdited(false);
                    setNewPageType('website');
                  }}
                  className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-[13px] font-medium rounded-lg transition-colors cursor-pointer border-0"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Page list */}
        {pages.length === 0 && !showNewForm ? (
          <div className="py-10 text-center text-[13px] text-slate-500">
            No pages yet. Create your first page to get started.
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {pages.map((page) => {
              const displayTitle = page.title || page.slug;
              const pageUrl = getPageUrl(project.slug, page.slug, page.pageType);

              return (
                <div key={page.id} className="px-5 py-3.5 hover:bg-slate-50 transition-colors">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                      <div className="font-medium text-[14px] text-slate-800">{displayTitle}</div>
                      <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full capitalize ${PAGE_TYPE_CLS[page.pageType]}`}>
                        {page.pageType}
                      </span>
                      <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full capitalize ${STATUS_CLS[page.status]}`}>
                        {page.status}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      {page.status === 'draft' && (
                        <button
                          onClick={() => handlePublish(page.id)}
                          disabled={publishingId === page.id}
                          className="px-3 py-1.5 bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white text-[12px] font-semibold rounded-lg transition-colors cursor-pointer border-0"
                        >
                          {publishingId === page.id ? 'Publishing...' : 'Publish'}
                        </button>
                      )}
                      {page.status === 'published' && page.publishedAt && (
                        <span className="text-[11px] text-slate-400">
                          Published {new Date(page.publishedAt).toLocaleDateString()}
                        </span>
                      )}
                    </div>
                  </div>
                  {page.status === 'published' && (
                    <a
                      href={pageUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[12px] text-indigo-500 hover:text-indigo-600 mt-1 inline-block"
                    >
                      {pageUrl.replace('https://', '')}
                    </a>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
