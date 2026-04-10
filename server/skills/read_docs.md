---
name: Read Docs
description: Retrieves documentation pages or sections from the connected documentation source (Notion, Confluence, GitHub Wiki, or similar). Returns structured content for downstream review or update proposals.
isActive: true
visibility: basic
---

```json
{
  "name": "read_docs",
  "description": "Retrieve documentation pages or sections from the connected documentation source. Returns page content, metadata (last updated, author), and structure for downstream review or update proposals. Used by the Knowledge Management Agent before proposing or writing documentation updates.",
  "input_schema": {
    "type": "object",
    "properties": {
      "page_id": {
        "type": "string",
        "description": "The ID or path of the documentation page to retrieve"
      },
      "page_title": {
        "type": "string",
        "description": "Human-readable page title — used if page_id is not available for search-based retrieval"
      },
      "section": {
        "type": "string",
        "description": "Optional: specific section or heading to retrieve within the page"
      },
      "include_metadata": {
        "type": "boolean",
        "description": "Whether to include page metadata (last updated, author, version). Default true."
      }
    }
  }
}
```

## Instructions

Invoke this skill before proposing or writing any documentation update. The Knowledge Management Agent must read existing content before proposing changes — do not propose updates to content you haven't read.

**MVP stub:** Documentation system integration not yet connected. Returns structured stub response.

## Methodology

### Data Schema

```
DOCUMENTATION PAGE

Page ID: [id]
Title: [title]
Last Updated: [ISO date]
Author: [last editor]
Source: [documentation system name]

---

Content:
[Full page content or requested section]

---

Metadata:
  Word Count: [N]
  Sections: [list of H2/H3 headings]
  Last Reviewed: [date or null]
  Status: [published | draft | archived]
```

### Stub Response

```
DOCUMENTATION PAGE

Status: stub — documentation integration not configured
Page ID: [requested id or title]

Note: Connect the documentation integration in workspace settings to enable
page retrieval. The Knowledge Management Agent requires read_docs before
invoking propose_doc_update or write_docs.
```
