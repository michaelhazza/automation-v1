---
name: Review Code
description: Structured self-review on all changed files before patch submission. Checks SOLID violations, security, correctness, conventions, and Gherkin AC coverage.
slug: review-code
runtimeSkillRef: review_code
---

Internal Dev Agent skill. Always invoked before submitting any patch via write_patch. No patch is submitted without a self-review pass.

See `server/skills/review_code.md` for the full runtime skill definition.
