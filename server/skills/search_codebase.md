---
name: Search Codebase
description: Search the project codebase for files, symbols, or text patterns.
isActive: true
isVisible: false
---

```json
{
  "name": "search_codebase",
  "description": "Search the project codebase for files, symbols, or text patterns. Use this to locate where functionality lives before reading or patching files.",
  "input_schema": {
    "type": "object",
    "properties": {
      "query": { "type": "string", "description": "The search term, symbol name, or text pattern to search for" },
      "search_type": { "type": "string", "description": "Type of search: \"text\" (full text grep), \"file\" (filename match), \"symbol\" (class/function names). Default: \"text\"" },
      "file_pattern": { "type": "string", "description": "Glob pattern to restrict search to certain files (e.g. \"*.ts\", \"src/**/*.tsx\")" },
      "max_results": { "type": "number", "description": "Maximum results to return (default 20)" }
    },
    "required": ["query"]
  }
}
```

## Instructions

Use search_codebase to find where functionality lives before reading files. Search for the class, function, or concept you need to change, then read the specific files. This is faster than reading files blindly.

## Methodology

### Search Strategy
1. **Symbol search first**: Search for the class or function name with `search_type: "symbol"` to find exact definitions.
2. **Text search for usage**: Search for how it's used across the codebase to understand dependencies.
3. **File search for structure**: Search for filenames to find related modules (`search_type: "file"`).

### Narrowing Results
- Use `file_pattern` to restrict to TypeScript (`*.ts`), React (`*.tsx`), or test files (`*.test.ts`).
- Start with broad terms; narrow if too many results.
- Use `max_results: 5` for quick lookups, higher for comprehensive analysis.

### Decision Rules
- **Search before reading**: Find the right file first; then read it.
- **Verify location**: A function may appear in multiple files (definition, tests, types). Confirm you found the right one.
- **Search for existing tests**: Before writing new tests, search for existing test files for the module.
