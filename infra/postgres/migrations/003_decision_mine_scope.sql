-- =============================================================
-- 003_decision_mine_scope.sql
--
-- `gov.decisions.mine_id` is declared in infra/postgres/init.sql, along with an
-- index on it, but does not exist on the deployed database — init.sql was never
-- applied there and the schema was created by some other route. Any query
-- written against the declared schema therefore fails at runtime rather than at
-- review time.
--
-- Without it, decision history cannot be scoped to a mine: decision memory would
-- offer one mine's outcomes as precedent for another, and mine-level isolation
-- would not extend to the decision record.
--
-- Idempotent: safe to re-run.
-- =============================================================

BEGIN;

ALTER TABLE gov.decisions ADD COLUMN IF NOT EXISTS mine_id TEXT;

-- Backfill from the linked prediction where one exists. Decisions with no
-- prediction keep NULL: inferring a mine for them would invent provenance, and
-- decision memory treats NULL as "unscoped" rather than as any given mine.
UPDATE gov.decisions d
   SET mine_id = p.entity_id
  FROM ml.predictions p
 WHERE d.prediction_id = p.id
   AND d.mine_id IS NULL
   AND p.entity_id IS NOT NULL
   AND EXISTS (SELECT 1 FROM ops.mines m WHERE m.mine_id = p.entity_id);

CREATE INDEX IF NOT EXISTS idx_decisions_mine
    ON gov.decisions (mine_id, lifecycle_state);

INSERT INTO gov.schema_migrations (version, description)
VALUES ('003_decision_mine_scope', 'Add gov.decisions.mine_id, declared in init.sql but absent from the deployed schema')
ON CONFLICT (version) DO NOTHING;

COMMIT;
