-- Role of a publish token, for least-privilege tokens (epic #296). Additive: one nullable column, no backfill.
-- NULL means admin. Nothing reads it for access yet. wrangler applies each migration once.
ALTER TABLE publish_tokens ADD COLUMN role TEXT;
