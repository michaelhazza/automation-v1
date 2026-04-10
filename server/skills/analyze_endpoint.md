---
name: Analyze Endpoint
description: Probe an API endpoint and verify contract compliance.
isActive: true
visibility: basic
---

## Parameters

- url: string (required) — The full URL to probe (e.g. "http://localhost:3000/api/users")
- method: string — HTTP method: "GET", "POST", "PUT", "PATCH", "DELETE" (default: "GET")
- headers: string — JSON object. Request headers as key-value pairs (optional)
- body: string — JSON object. Request body for POST/PUT/PATCH requests (optional)
- expected_status: number — Expected HTTP status code (default: 200)

## Instructions

Use analyze_endpoint to verify API contracts after code changes. Check that status codes, response shapes, and latency meet expectations. Report failures as bugs using report_bug.

### What to Check
1. **Status code**: Does the response match `expected_status`?
2. **Response shape**: Does the JSON structure match the expected contract (required fields, types)?
3. **Error responses**: For error paths, verify the error format is consistent.
4. **Latency**: Flag responses over 2000ms as a performance concern.

### Test Cases Per Endpoint
- **Happy path**: Valid request with expected inputs.
- **Missing required fields**: Expect 400 validation error.
- **Unauthorized**: Without auth headers, expect 401.
- **Not found**: With a non-existent resource ID, expect 404.

### Reporting
- If status code does not match expected: file a bug with severity based on impact.
- If response shape is wrong: file a bug with the actual vs expected shape.
- If latency is excessive: file a low-severity bug with the measured latency.

### Decision Rules
- **Test incrementally**: Focus on endpoints related to the current task.
- **Use realistic test data**: Avoid edge cases that are not representative of real usage.
- **Document baseline**: Record the baseline behaviour before changes for comparison.
