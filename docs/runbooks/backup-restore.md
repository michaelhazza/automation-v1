# Backup and Restore Runbook

## Automated backups

This application uses Neon/Supabase/your provider for PostgreSQL hosting. Automated backups are configured with X-hour retention.

## Point-in-time restore (PITR)

1. Navigate to the database provider console
2. Select the target database
3. Choose "Restore" or "Branch from point in time"
4. Select the target timestamp
5. Confirm the restore operation
6. Update connection strings if a new endpoint is created

## Manual restore from dump file

```bash
pg_restore --host=$DB_HOST --port=$DB_PORT --username=$DB_USER --dbname=$DB_NAME --no-owner --no-acl backup.dump
```

## Restore validation queries

After restoring, run these SQL queries to validate data integrity:

```sql
-- Row-count sanity
SELECT COUNT(*) FROM organisations;
SELECT COUNT(*) FROM agents;
SELECT COUNT(*) FROM workflow_runs;

-- Orphaned task_events (should be 0)
SELECT COUNT(*) FROM task_events te
LEFT JOIN tasks t ON t.id = te.task_id
WHERE t.id IS NULL;

-- Orphaned workflow_runs (should be 0)
SELECT COUNT(*) FROM workflow_runs wr
LEFT JOIN tasks t ON t.id = wr.task_id
WHERE t.id IS NULL;

-- Recent writes check
SELECT MAX(created_at) FROM workflow_runs;
```

All orphaned-row counts must be 0. `MAX(created_at)` must fall within the RPO window.

## Targets

- RPO (Recovery Point Objective): 1 hour
- RTO (Recovery Time Objective): 4 hours

## Escalation

1. On-call engineer (PagerDuty rotation)
2. Engineering lead
3. CTO
