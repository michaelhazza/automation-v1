---
name: Update Page
description: Update an existing page's HTML, meta, or form configuration.
isActive: true
visibility: basic
---

```json
{
  "name": "update_page",
  "description": "Update an existing page's HTML content, meta tags, or form configuration. A version snapshot is saved automatically before each update.",
  "input_schema": {
    "type": "object",
    "properties": {
      "pageId": { "type": "string", "description": "ID of the page to update" },
      "projectId": { "type": "string", "description": "ID of the project the page belongs to" },
      "html": { "type": "string", "description": "New HTML content for the page body" },
      "meta": { "type": "object", "description": "Updated SEO and social meta fields" },
      "formConfig": { "type": "object", "description": "Updated form configuration" },
      "changeNote": { "type": "string", "description": "Brief note explaining what changed (saved with version history)" }
    },
    "required": ["pageId", "projectId"]
  }
}
```

## Instructions

When updating a page, always include a `changeNote` explaining what changed and why. Version history is saved automatically before each update, so changes can be reviewed or rolled back.

## Methodology

### Update Checklist
1. **Include a change note**: Every update should have a clear `changeNote` (e.g., "Updated hero CTA copy" or "Fixed mobile layout issue").
2. **Update only what changed**: Only include fields that need modification. Omitted fields are left unchanged.
3. **Verify with preview**: After updating, use the returned preview URL to verify the changes look correct.

### Decision Rules
- **Version history is automatic**: The current state is snapshotted before the update is applied.
- **HTML is re-sanitized**: Updated HTML goes through the same sanitization as creation.
- **Draft and published pages can both be updated**: Updates go through human review before being applied to the live page.
