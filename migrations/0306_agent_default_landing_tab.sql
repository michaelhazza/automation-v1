ALTER TABLE users ADD COLUMN default_agent_tab text NOT NULL DEFAULT 'overview'
  CHECK (default_agent_tab IN ('overview','configure','behaviour','personality','skills','scorecards','data-sources','schedule','budget','runs'));
