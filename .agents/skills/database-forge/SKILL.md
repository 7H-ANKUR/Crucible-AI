---
name: database-forge
description: Use when designing schemas, writing migrations, building queries, debugging slow performance, reviewing any database work, or making storage-engine decisions — SQL (Postgres, MySQL), MongoDB, Redis, Prisma, Drizzle, TypeORM, SQLAlchemy. Enforces naming conventions, constraint-driven integrity, indexing strategy with EXPLAIN verification, zero-downtime migrations, transactional correctness, tenant isolation, and injection-proof access. A schema or query is never "done" without the checklists passing.
---

# Database Forge — Correct, Fast, Safe

The schema is a contract every future feature lives with, and a wrong index is an outage waiting for scale. You design constrained, indexed, migratable, and secure by default.

## 0. Prime Directives

1. **The database enforces truth.** Business invariants are constraints, not application hopes. If two columns can't both be true, the DB must reject it.
2. **Every query is hostile until parameterized.**
3. **Migrations must never take downtime.** Additive-first, phased, reversible.
4. **Hot path = measured path.** EXPLAIN or it didn't happen.
5. **Multi-tenant data must be impossible to cross, not merely unlikely.**

---

## 1. Naming & Types

**Conventions:** snake_case everywhere, plural tables (`invoices`), singular columns (`invoice_id`), FK columns named exactly after the referenced PK (`invoices.user_id` → `users.id`), booleans `is_`/`has_` prefixed, timestamps `_at` suffixed, indexes `idx_<table>_<cols>`, unique `uq_`, checks `ck_`, FKs `fk_`.

**Type decision matrix:**

| Data | Use | Never |
|---|---|---|
| Money | `numeric(12,2)` (+ currency code column) | float/double |
| IDs | `uuid` (v7 for time-ordered) or bigserial single-node | random strings |
| Timestamps | `timestamptz` | `timestamp` naive, epoch ints |
| Dates | `date` | text |
| Email | `citext` (PG) or `text` + `CHECK (email = lower(email))` + unique | case-sensitive unique |
| Enum/status | `text` + CHECK or FK lookup table | int magic codes |
| Booleans | `boolean` | int 0/1 flags |
| Short text | `text` + `CHECK (char_length(x) <= N)` | varchar(n) as validation theatre |
| JSON blobs | `jsonb` ONLY for truly schemaless attributes; never core relational fields | json (PG), stringified JSON |
| Phone | `text` + E.164 normalization at app layer | int |

**IDs:** UUIDv7/snowflake when distributed generation or shard-likely; bigint sequence single-node (narrower indexes). Composite natural keys only for pure join tables.

---

## 2. Every Table Ships With

```sql
created_at timestamptz NOT NULL DEFAULT now(),
updated_at timestamptz NOT NULL DEFAULT now(),   -- trigger or ORM auto-update
```
NOT NULL by default — nullability is an explicit, justified decision per column. Every FK gets an explicit ON DELETE. Every status gets a CHECK or lookup table. Money always paired with currency.

## 3. Constraint Catalog — encode business rules

- `UNIQUE` on every natural key (email, slug, external-id + provider pair).
- `CHECK` ranges: `CHECK (quantity > 0)`, `CHECK (discount <= total)`, `CHECK (status IN ('draft','active','archived'))`.
- **Partial unique** for "only one X": `UNIQUE (user_id) WHERE status = 'active'` — one active subscription per user, one primary email, etc.
- **Exclusion** where overlap is illegal (bookings): `EXCLUDE USING gist (room_id WITH =, during WITH &&)`.
- FK actions decision table:

| Relationship | ON DELETE |
|---|---|
| Owned child (order_items→orders) | CASCADE |
| Reference (orders→users) | RESTRICT (or SET NULL if history detachable) |
| Optional/audit link | SET NULL |
| Join table both sides | CASCADE |

- Soft delete (`deleted_at timestamptz`) ONLY with a real audit/undo requirement — it complicates every unique constraint and query; prefer audit tables + hard delete.

---

## 4. Schema Pattern Library (use these instead of inventing)

- **Multi-tenancy (shared schema):** `tenant_id NOT NULL` on EVERY tenant-owned table + index leading with `tenant_id`; RLS policy (section 10); repository layer injects it; unique constraints become composite (`UNIQUE (tenant_id, email)`).
- **Audit/history:** append-only `audit_log(id, table_name, record_id, actor_id, action, diff jsonb, at)` or a `_history` shadow table populated by trigger.
- **Money line items:** store unit_price + quantity + computed-at-write total (snapshotted, never recomputed from a mutable price).
- **Tags:** join table `item_tags(item_id, tag_id)` — never a comma-string or array column queried with `LIKE`.
- **Hierarchy:** `parent_id` FK (self) for shallow; closure table or `ltree` (PG) for deep querying.
- **Versioned records:** immutable rows + `superseded_by_id`; current = `superseded_by_id IS NULL` with a partial index.
- **External integrations:** `external_provider`, `external_id` with `UNIQUE (provider, external_id)`, sync state, last_synced_at.
- **Outbox pattern for reliable events:** `outbox(id, event_type, payload jsonb, processed_at)` — write in the same transaction as the business change, a worker drains it.

## 5. Indexing

**Index-type selection:**

| Type | Use when |
|---|---|
| B-tree (default) | equality, ranges, ORDER BY |
| Composite B-tree | multi-condition; column order = equality first, then range/sort |
| Covering (`INCLUDE`) | hot queries where heap access is the cost |
| Partial | fixed filter subset (unprocessed rows, active only) — smaller, faster |
| Expression | queries on `lower(email)`, `(data->>'k')` |
| GIN | jsonb containment, arrays, full-text |
| BRIN | huge append-only time-series (logs) |
| Hash | pure equality on long keys (rare) |

Rules:
- **Index every FK you join or filter on** — Postgres does NOT auto-create these.
- One index per access pattern, not per column. Anti-patterns: indexing everything (write amplification); lone index on low-cardinality (`status` alone); redundant left-prefixes of composite indexes.
- Pagination sort keys need the exact composite index used by the ORDER BY.
- Verify: `EXPLAIN (ANALYZE, BUFFERS)` — no Seq Scan on >10k rows unless deliberate; watch `rows` estimation vs actual (huge skew ⇒ run ANALYZE).
- Track usage: `pg_stat_user_indexes` — drop `idx_scan = 0` after a full traffic cycle.

## 6. Query Correctness

- No `SELECT *` in app code — explicit columns (contract stability + covering indexes).
- **N+1 is a bug class, not an accident.** Audit every loop containing a query; fix via `IN` batch, JOIN, or dataloader. In ORMs: eager-load relations used in the response.
- JOINs over correlated subqueries for row filters; `EXISTS` over `IN (subquery)` when the subquery can return huge sets.
- Window functions for "latest per group": `ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY created_at DESC)` filtered to rn=1.
- **Keyset pagination:** `WHERE (created_at, id) < ($1, $2) ORDER BY created_at DESC, id DESC LIMIT 50` with matching composite index. OFFSET skips O(n) rows — at page 1000 that's an outage vector.
- Count costs: exact `COUNT(*)` on big tables is a scan — use estimates (`pg_class.reltuples`) or cached counters for UI totals.
- `LIKE '%x%'` can't use B-tree — use PG trigram (pg_trgm + GIN) or full-text (`tsvector` + GIN) for search.

## 7. Transactions & Concurrency

- Multi-row/multi-table writes ⇒ single transaction, always. Keep it short: no HTTP calls, no email sends, no user think-time inside.
- **Isolation levels:** default READ COMMITTED for most; REPEATABLE READ/SERIALIZABLE when read-modify-write spans statements — with retry-on-serialization-failure loops (backoff + jitter, ≤3 attempts).
- Optimistic concurrency for user edits: `version int` column, `WHERE id = $1 AND version = $2`, 0 rows updated ⇒ 409 conflict — not silent last-write-wins.
- Counter decrements without going negative: `UPDATE ... SET stock = stock - 1 WHERE id = $1 AND stock >= 1` and check rowcount — never SELECT-then-UPDATE.
- Consistent lock ordering across all code paths (document the order) to prevent deadlocks; on deadlock, retry with backoff.
- Long jobs: claim rows with `FOR UPDATE SKIP LOCKED`.

## 8. Zero-Downtime Migration Playbook

- Versioned files (sequential, immutable once shipped). Never edit an applied migration. Never auto-sync shared/prod environments.
- The safe change pattern for anything on a big live table:
  1. Add nullable column (instant)
  2. Backfill in batches (`WHERE col IS NULL LIMIT 10000` loop, throttled, off-peak)
  3. Add NOT NULL via `ADD CONSTRAINT ... NOT VALID` then `VALIDATE` (PG 12+, avoids full lock)
  4. Remove old column in a LATER release, after code no longer references it
- Rename = add-new + dual-write + migrate reads + drop-old (never a single `RENAME` on live traffic).
- Indexes on live tables: `CREATE INDEX CONCURRENTLY` (non-transactional — run outside a transaction block).
- Every migration has a `down` or is explicitly marked forward-only with reason. Seeds are separate from schema migrations.
- Pre-flight: run against a prod-sized copy; measure; rollback plan written before applying.

## 9. Performance & Scaling

- **Connection pool:** app pool = (cores × 2 + spindle) heuristic, capped well below DB max; pgbouncer (transaction mode) for many instances/serverless; statement timeout (1–5s app role), idle-in-transaction timeout (30–60s).
- **Caching layers:** cache-aside for read-heavy entities; invalidate on write (by key or tag); NEVER cache without TTL + invalidation story; counters via Redis atomic ops.
- **Materialized views** for expensive aggregates; `REFRESH CONCURRENTLY` scheduled.
- **Partitioning** when a table exceeds ~50–100M rows or indexes exceed RAM: range by time (logs, events); queries must hit the partition key or they scan all.
- **Read replicas** for reporting-heavy reads; accept replication lag — never route a read-after-write of the user's own write to a replica.
- Postgres hygiene: autovacuum tuned for high-churn tables, monitor bloat (`pg_stat_user_tables.n_dead_tup`), `ANALYZE` after big backfills.

## 10. Security

- Parameterized only — ORM query builders or `$1` placeholders. One string-interpolated query = critical failure, grep for it.
- Two DB roles: `app` (no DDL, no TRUNCATE, only needed tables), `migrator` (DDL, used only by migration runs). Never connect as owner/superuser at runtime.
- **Row-Level Security for tenant isolation (Postgres):** `ENABLE ROW LEVEL SECURITY` on tenant tables + `CREATE POLICY tenant_isolation USING (tenant_id = current_setting('app.tenant_id')::uuid)`; set the GUC per request/transaction. Defense in depth on top of app-layer filtering.
- Connection strings from env only. TLS to DB on untrusted networks. Encryption at rest for PII-heavy stores; column-level encryption for crown jewels with keys in a KMS, and a blind-index (HMAC) column if you must look them up.
- Audit triggers on sensitive tables writing to an append-only audit schema.
- Backups: automated, encrypted, offsite, PITR (WAL archiving); **restore drilled quarterly** — an untested backup is a hope, not a backup.

## 11. Engine Quick-Notes

- **Postgres:** default choice. jsonb+GIN, partial/expression indexes, RLS, advisory locks, `SKIP LOCKED`, ltree, pg_trgm — use them.
- **MySQL:** InnoDB always; utf8mb4 always; no RLS — enforce tenancy purely in the repository layer with integration tests; `ON UPDATE CURRENT_TIMESTAMP` for updated_at.
- **MongoDB:** schema validation (`$jsonSchema`) on every collection; no unbounded arrays in documents (16MB + forever-growth); read concern majority for read-your-own-writes; indexes still mandatory (`explain()`); avoid `$lookup` in hot paths.
- **Redis:** it's a cache/queue, not a source of truth (unless AOF + tested failover); set `maxmemory` + eviction policy; never store secrets unencrypted; use Lua for atomic multi-step ops; prefix keys by service.
- **Choosing:** default Postgres; Mongo only for genuinely schemaless, write-heavy, non-relational docs; Redis for cache/queue/locks/rate-limits — never as the primary store of business data.

## 12. Schema Review Checklist

- [ ] snake_case/plural conventions; every table has PK + created_at/updated_at
- [ ] Correct types (numeric money, timestamptz, checked status)
- [ ] NOT NULL by default; nullability justified per column
- [ ] FKs: explicit ON DELETE chosen per decision table; FK columns indexed
- [ ] Natural keys UNIQUE; business invariants as CHECK/partial-unique/exclusion
- [ ] No magic strings without constraints; no comma-list tags; no relational data dumped into jsonb

## 13. Query/Migration Review Checklist

- [ ] Zero interpolated SQL (grep raw/f-string/`+ "`)
- [ ] No N+1 (grep queries inside loops; ORM eager-loads present)
- [ ] Hot queries pass EXPLAIN (ANALYZE, BUFFERS); indexes match the WHERE+ORDER BY
- [ ] Keyset pagination on large lists
- [ ] Multi-step writes in one short transaction; no I/O inside transactions
- [ ] Lock ordering consistent; deadlock retry in place; optimistic versioning on user edits
- [ ] Migrations: versioned, immutable, additive-first, CONCURRENTLY where needed, reversible or marked, backfills batched
- [ ] Least-privilege roles; RLS/policy for tenancy; statement + idle timeouts set
- [ ] Backups + PITR configured and restore-drilled
