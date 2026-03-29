-- Add review_required flag to tasks for gate escalation
ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "review_required" boolean NOT NULL DEFAULT false;
