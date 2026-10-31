-- Which deploy built the sandbox: a new deploy replaces older sandboxes (they would keep running the old image).
ALTER TABLE sim_sessions ADD COLUMN rev TEXT;
