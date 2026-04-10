---
name: Publish Post
description: Submits an approved social media post for publishing (immediately or at a scheduled time) via the connected platform integration. Review-gated — requires human approval before execution.
isActive: true
visibility: none
---

## Parameters

- platform: enum[twitter, linkedin, instagram, facebook] (required) — Target publishing platform
- post_content: string (required) — The final approved post copy (from draft_post output, post human review)
- schedule_at: string — ISO 8601 datetime to schedule the post (e.g. 2026-04-15T09:00:00Z). If omitted, publishes immediately upon approval.
- media_urls: string — JSON array of string values. Optional list of media attachment URLs (images, video). Must be accessible to the platform integration.
- hashtags_in_comment: boolean — Instagram only: post hashtags in the first comment rather than the caption. Default false.
- campaign_tag: string — Optional campaign identifier for analytics grouping
- reasoning: string (required) — Why this post is being published now: campaign context, timing rationale, approval chain summary. Shown to the human reviewer.

## Instructions

Invoke this skill only after `draft_post` has produced copy that has been reviewed and approved. This skill handles the publishing step — do not use it to draft content.

This is a review-gated action. It enters the HITL approval queue and waits for a human to approve before publishing. The reviewer sees the full post content, the target platform, the schedule time (if any), and the reasoning.

On approval: the post is submitted to the connected platform integration. If `schedule_at` is provided, the post is queued at that time. If omitted, it publishes immediately.

On rejection: read the rejection feedback, revise the post content if needed (re-invoke `draft_post`), or surface the rejection to the requesting agent.

**MVP note:** The platform integration (API calls to Twitter/LinkedIn/Instagram/Facebook) is a stub at this stage. The approval workflow is fully wired; the actual publish call will be implemented when the social media API integrations are connected. On approval, the executor logs the intended publish action and returns a `pending_integration` status.

### Pre-Submission Checklist

Before submitting to the review queue:
1. Post content is within the platform's character limit
2. If `schedule_at` is provided, it is in the future (at least 10 minutes from now)
3. `media_urls` are reachable if provided
4. `reasoning` explains the timing and campaign context — the reviewer should not need to guess why this is being published now
5. Content does not contain `[VERIFY]` placeholders — those must be resolved before submitting for publish approval

### Review Item Presentation

The review item must show:
1. **Platform + timing**: where and when the post will go live
2. **Post content**: full text as it will appear (including any hashtags)
3. **Media preview**: URLs if attached
4. **Campaign tag**: if provided
5. **Reasoning**: the agent's rationale for publishing
6. **Character count**: so the reviewer can sanity-check platform constraints

### On Approval

1. Submit the post to the platform integration
2. If `schedule_at` was provided, confirm the scheduled time in the response
3. Log the publish action to workspace memory: `social_publish:[platform]:[ISO_date]` with post content, campaign_tag, and publish status
4. Return `{ success: true, platform, publish_status, scheduled_for, campaign_tag }`

### On Rejection

Return the rejection feedback to the calling agent so it can:
- Revise the post copy (re-invoke `draft_post`)
- Adjust the schedule
- Cancel the publish entirely

### Idempotency

If the same post content + platform + schedule_at combination is submitted twice within a 60-minute window, surface a warning to the reviewer rather than creating a duplicate review item. This prevents accidental double-publishing from agent retries.
