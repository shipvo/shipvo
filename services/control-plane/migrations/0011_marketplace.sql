-- Public listing: an owner opts an app in; it shows in the directory once approved and any signed-in key may open it.
ALTER TABLE apps ADD COLUMN description TEXT NOT NULL DEFAULT '';
ALTER TABLE apps ADD COLUMN category TEXT NOT NULL DEFAULT 'other';
ALTER TABLE apps ADD COLUMN listed INTEGER NOT NULL DEFAULT 0;      -- owner asked to be listed
ALTER TABLE apps ADD COLUMN approved INTEGER NOT NULL DEFAULT 0;    -- reviewed (owner token)
ALTER TABLE apps ADD COLUMN latest_release INTEGER;
ALTER TABLE apps ADD COLUMN published_at TEXT;
ALTER TABLE apps ADD COLUMN opens INTEGER NOT NULL DEFAULT 0;
