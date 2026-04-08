---
name: Web Search
description: Search the web for current information using Tavily AI search.
isActive: true
visibility: basic
---

```json
{
  "name": "web_search",
  "description": "Search the web for current information. Use this when you need to find up-to-date facts, news, competitor information, or any real-time data.",
  "input_schema": {
    "type": "object",
    "properties": {
      "query": { "type": "string", "description": "The search query" },
      "max_results": { "type": "number", "description": "Maximum number of results to return (default 5, max 10)" }
    },
    "required": ["query"]
  }
}
```

## Instructions

Use web search to find current information, verify facts, research competitors, or gather data that may not be in your training data. Always search when dealing with dates, prices, current events, or anything time-sensitive. Cross-reference key claims across multiple results.

## Methodology

### Phase 1: Broad Scan
Start with a broad query to understand the landscape. Request 5-10 results for a representative spread.

### Phase 2: Targeted Deep-Dive
Based on broad scan results, formulate 2-3 specific follow-up queries. Reduce max_results to 3-5 for focused results.

### Phase 3: Verification & Synthesis
Cross-reference key claims across multiple results. If a critical fact appears in only one source, run a verification query.

### Decision Rules
- **Always search** when: dates, prices, current events, competitor activity, or anything time-sensitive.
- **Search before asserting** when: not fully confident in a specific fact or statistic.
- **Multiple queries** when: topic has multiple dimensions.
- **Skip search** when: information is clearly within training data and does not change.
