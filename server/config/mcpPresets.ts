// ---------------------------------------------------------------------------
// MCP Preset Catalogue — curated, tested MCP server definitions shipped with
// the app. Users pick from this catalogue to add integrations.
// ---------------------------------------------------------------------------

export type McpPresetCategory =
  | 'communication'
  | 'crm'
  | 'developer'
  | 'data_search'
  | 'finance'
  | 'files_storage'
  | 'productivity'
  | 'browser';

export interface McpPreset {
  slug: string;
  name: string;
  description: string;
  category: McpPresetCategory;
  iconUrl?: string;
  transport: 'stdio';
  command: string;
  args: string[];
  credentialProvider?: string;
  requiresConnection: boolean;
  recommendedGateLevel: 'auto' | 'review';
  toolCount: number;
  toolHighlights: string[];
  setupNotes?: string;
}

export const MCP_PRESET_CATEGORY_LABELS: Record<McpPresetCategory, string> = {
  communication: 'Communication',
  crm: 'CRM',
  developer: 'Developer Tools',
  data_search: 'Data & Search',
  finance: 'Finance',
  files_storage: 'Files & Storage',
  productivity: 'Productivity',
  browser: 'Browser',
};

export const MCP_PRESETS: McpPreset[] = [
  // ── Communication ──────────────────────────────────────────────────────────
  {
    slug: 'gmail',
    name: 'Gmail',
    description: 'Send, read, and search emails via Google Gmail.',
    category: 'communication',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@anthropic/gmail-mcp-server@1.0.0'],
    credentialProvider: 'gmail',
    requiresConnection: true,
    recommendedGateLevel: 'review',
    toolCount: 5,
    toolHighlights: ['send_email', 'read_inbox', 'search_messages', 'read_thread', 'list_labels'],
    setupNotes: 'Requires a Gmail OAuth connection. The subaccount or org must have Gmail connected.',
  },
  {
    slug: 'slack',
    name: 'Slack',
    description: 'Post messages, read channels, and manage conversations in Slack.',
    category: 'communication',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@anthropic/slack-mcp-server@1.0.0'],
    credentialProvider: 'slack',
    requiresConnection: true,
    recommendedGateLevel: 'auto',
    toolCount: 8,
    toolHighlights: ['post_message', 'list_channels', 'read_channel', 'search_messages'],
    setupNotes: 'Requires a Slack OAuth connection with chat:write and channels:read scopes.',
  },

  // ── CRM ────────────────────────────────────────────────────────────────────
  {
    slug: 'hubspot',
    name: 'HubSpot',
    description: 'Manage contacts, deals, and companies in HubSpot CRM.',
    category: 'crm',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@anthropic/hubspot-mcp-server@1.0.0'],
    credentialProvider: 'hubspot',
    requiresConnection: true,
    recommendedGateLevel: 'auto',
    toolCount: 12,
    toolHighlights: ['search_contacts', 'create_contact', 'search_deals', 'create_deal', 'list_companies'],
    setupNotes: 'Requires a HubSpot OAuth connection with contacts, content, and deals scopes.',
  },

  // ── Developer ──────────────────────────────────────────────────────────────
  {
    slug: 'github',
    name: 'GitHub',
    description: 'Manage repositories, issues, pull requests, and code on GitHub.',
    category: 'developer',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@anthropic/github-mcp-server@1.0.0'],
    credentialProvider: 'github',
    requiresConnection: true,
    recommendedGateLevel: 'auto',
    toolCount: 12,
    toolHighlights: ['search_repos', 'create_issue', 'list_prs', 'read_file', 'create_pr'],
    setupNotes: 'Requires a GitHub App installation or OAuth connection.',
  },

  // ── Data & Search ──────────────────────────────────────────────────────────
  {
    slug: 'brave_search',
    name: 'Brave Search',
    description: 'Web search via Brave Search API. No OAuth needed — uses API key.',
    category: 'data_search',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@anthropic/brave-search-mcp-server@1.0.0'],
    requiresConnection: false,
    recommendedGateLevel: 'auto',
    toolCount: 2,
    toolHighlights: ['web_search', 'local_search'],
    setupNotes: 'Requires BRAVE_API_KEY in environment variables. Get one at brave.com/search/api.',
  },

  // ── Finance ────────────────────────────────────────────────────────────────
  {
    slug: 'stripe',
    name: 'Stripe',
    description: 'Manage payments, customers, and subscriptions via Stripe.',
    category: 'finance',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@anthropic/stripe-mcp-server@1.0.0'],
    credentialProvider: 'stripe',
    requiresConnection: false,
    recommendedGateLevel: 'review',
    toolCount: 8,
    toolHighlights: ['list_customers', 'create_checkout', 'get_balance', 'list_invoices'],
    setupNotes: 'Requires STRIPE_SECRET_KEY in environment variables.',
  },

  // ── Productivity ───────────────────────────────────────────────────────────
  {
    slug: 'notion',
    name: 'Notion',
    description: 'Read and write pages, databases, and blocks in Notion.',
    category: 'productivity',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@anthropic/notion-mcp-server@1.0.0'],
    requiresConnection: false,
    recommendedGateLevel: 'auto',
    toolCount: 10,
    toolHighlights: ['search', 'read_page', 'create_page', 'query_database', 'update_block'],
    setupNotes: 'Requires NOTION_API_KEY in environment variables. Create an integration at notion.so/my-integrations.',
  },
];
