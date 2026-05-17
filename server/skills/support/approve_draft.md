---
name: Approve Draft
description: Approve and dispatch an AI-proposed support reply draft.
isActive: true
visibility: basic
---

## Parameters
- draftId: string — canonical draft UUID
- reviewNotes: string (optional) — notes recorded with the approval decision

## Instructions
Approve a draft to dispatch it to the customer via the connected helpdesk provider. The dispatch is three-phase: preflight validation, durable lock, then provider call. Use only when you have reviewed the draft body and it is correct and complete.
