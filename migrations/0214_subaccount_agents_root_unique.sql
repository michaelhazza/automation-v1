CREATE UNIQUE INDEX subaccount_agents_one_root_per_subaccount
  ON subaccount_agents (subaccount_id)
  WHERE parent_subaccount_agent_id IS NULL AND is_active = true;
