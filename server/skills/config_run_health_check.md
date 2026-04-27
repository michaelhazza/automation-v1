---
name: Config Run Health Check
description: Run workspace health audit and return findings (missing skills, broken schedules, etc.).
isActive: true
visibility: basic
---

## Parameters

- subaccountId: string (optional) — If omitted, runs org-wide.

## Instructions

Runs the workspace health audit and returns findings. Call this after completing a configuration plan to validate the result. Reports missing skills, agents without links, broken schedules, and other configuration issues. Only run if at least one mutation was executed in the session.
