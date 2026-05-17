---
name: Reject Draft
description: Reject an AI-proposed support reply draft.
isActive: true
visibility: basic
---

## Parameters
- draftId: string — canonical draft UUID
- reason: string — reason for rejection (recorded in the audit trail)

## Instructions
Reject a draft that is not suitable to send. The reason is recorded for the audit trail and may be used to improve future proposals. The draft moves to rejected status and will not be dispatched.
