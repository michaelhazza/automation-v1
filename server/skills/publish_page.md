---
name: Publish Page
description: Publish a draft page, making it publicly accessible on its subdomain.
isActive: true
visibility: basic
---

```json
{
  "name": "publish_page",
  "description": "Publish a draft page to make it publicly accessible. This action goes through human review by default.",
  "input_schema": {
    "type": "object",
    "properties": {
      "pageId": { "type": "string", "description": "ID of the page to publish" },
      "projectId": { "type": "string", "description": "ID of the project the page belongs to" }
    },
    "required": ["pageId", "projectId"]
  }
}
```

## Instructions

Publishing makes a page publicly accessible on its project's subdomain. This action requires human review before execution. Use the preview URL to verify the page looks correct before requesting publication.

## Methodology

### Pre-Publish Checklist
1. **Preview first**: Always review the page via its preview URL before publishing.
2. **Check meta tags**: Ensure the page has appropriate title and description meta tags for SEO and social sharing.
3. **Verify mobile layout**: If the page targets mobile users, confirm the layout is responsive.
4. **Review form config**: For landing pages with forms, verify field definitions and submission behaviour.

### Decision Rules
- **Human review required**: This action is review-gated. A human must approve before the page goes live.
- **Only draft pages can be published**: Already-published pages cannot be re-published.
- **Subdomain serving**: Once published, the page is served at `{projectSlug}.{domain}/{pageSlug}`.
