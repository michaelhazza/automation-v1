-- Migration: GitHub App integration + project repo URL
-- 1. Add repoUrl and githubConnectionId columns to projects table
-- 2. No schema change needed for integration_connections.auth_type (text column, no enum)

ALTER TABLE "projects" ADD COLUMN "repo_url" text;
ALTER TABLE "projects" ADD COLUMN "github_connection_id" uuid REFERENCES "integration_connections"("id");
