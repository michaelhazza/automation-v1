-- Fixture: simulates migration 0003 appearing before 0002 (out-of-order)
-- This is a test fixture — not a real migration.
CREATE TABLE IF NOT EXISTS fixture_out_of_order_test (id SERIAL PRIMARY KEY);
