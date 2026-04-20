import 'dotenv/config';
import pg from 'pg';
const { Client } = pg;
const client = new Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

const jobId = process.argv[2] ?? '2a18b7d5-fc9d-4428-a599-a009799776ee';

const job = await client.query(
  `SELECT id, status, progress_pct, progress_message, classify_state, candidate_count, created_at, updated_at, error_message
   FROM skill_analyzer_jobs WHERE id=$1`,
  [jobId]
);
console.log('JOB:', JSON.stringify(job.rows[0], null, 2));

const res = await client.query(
  `SELECT COUNT(*)::int AS total,
          COUNT(*) FILTER (WHERE classification='DUPLICATE')::int AS duplicates,
          COUNT(*) FILTER (WHERE classification='DISTINCT')::int AS distinct_,
          COUNT(*) FILTER (WHERE classification='PARTIAL_OVERLAP')::int AS partial,
          COUNT(*) FILTER (WHERE classification='IMPROVEMENT')::int AS improvement,
          COUNT(*) FILTER (WHERE classification_failed=true)::int AS failed
   FROM skill_analyzer_results WHERE job_id=$1`,
  [jobId]
);
console.log('RESULTS:', JSON.stringify(res.rows[0], null, 2));

// Check llm_logs for this job (Anthropic adapter writes here)
try {
  const llm = await client.query(
    `SELECT COUNT(*)::int AS calls,
            SUM((response->>'input_tokens')::int) AS input_tokens,
            SUM((response->>'output_tokens')::int) AS output_tokens,
            MIN(created_at) AS first_call,
            MAX(created_at) AS last_call
     FROM llm_logs WHERE correlation_id=$1 OR run_id=$1`,
    [jobId]
  );
  console.log('LLM_LOGS:', JSON.stringify(llm.rows[0], null, 2));

  const recent = await client.query(
    `SELECT created_at, model, status, latency_ms, error_message
     FROM llm_logs
     WHERE correlation_id=$1 OR run_id=$1
     ORDER BY created_at DESC LIMIT 10`,
    [jobId]
  );
  console.log('RECENT LLM CALLS:');
  for (const r of recent.rows) console.log(' ', JSON.stringify(r));
} catch (e) {
  console.log('llm_logs query failed:', e.message);
}

// Check pg-boss
try {
  const bossJob = await client.query(
    `SELECT id, name, state, retrycount, startedon, completedon, createdon, output
     FROM pgboss.job WHERE data->>'jobId' = $1 ORDER BY createdon DESC LIMIT 5`,
    [jobId]
  );
  console.log('PGBOSS JOBS:');
  for (const r of bossJob.rows) console.log(JSON.stringify(r, null, 2));
} catch (e) {
  console.log('pg-boss query failed:', e.message);
}

await client.end();
