-- 0006: store the type-specific inputs sent to the provider (comments,
-- usernames, hashtag, donor username, poll answer, groups, keywords,
-- dripfeed runs/interval) as JSON, so a disputed order can be checked
-- against what was actually submitted.
-- Capped in code (capOrderExtras, index.ts): this column never holds more
-- than 64KB, and the cap is storage-only — the provider always receives
-- the full inputs, so delivery is never shorted.
-- Orders placed before this migration keep extras NULL: inputs were never
-- stored, and CID does not return them, so they cannot be backfilled.
ALTER TABLE orders ADD COLUMN extras TEXT;
