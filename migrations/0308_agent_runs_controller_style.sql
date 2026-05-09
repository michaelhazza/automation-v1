ALTER TABLE agent_runs ADD COLUMN controller_style text NOT NULL DEFAULT 'native' CHECK (controller_style IN ('native', 'operator'));
CREATE INDEX agent_runs_controller_style_idx ON agent_runs(controller_style) WHERE controller_style = 'operator';
