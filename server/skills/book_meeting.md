---
name: Book Meeting
description: Books a meeting on a configured calendar provider. Idempotent on (prospect_email, requested_slot).
isActive: true
visibility: basic
---

## Parameters

- prospect_email: string (required) — Email address of the prospect to book with.
- requested_slot: string (required, ISO datetime) — The requested meeting start time.
- duration_minutes: integer (optional, default 30) — Meeting duration in minutes.
- title: string (optional) — Meeting title. Defaults to a standard intro meeting title.

## Instructions

Book the meeting at the requested slot. If the slot is already booked, return the existing booking. If no calendar provider is configured, return status=not_configured. Return the booking confirmation including meeting link.
