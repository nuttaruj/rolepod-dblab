---
name: db-query
description: Assert live database state as verify-phase evidence. Run a read-only query and check it against an expected exists / row_count / value, returning a structured PASS/FAIL — not raw rows. Use to prove a row exists, a count matches, or a value landed after a change.
---

# /db-query

Single-backend skill. Calls **`rolepod_db_query`** on the rolepod-dblab MCP server and surfaces the structured result. No fallback (D-001).

> Did the data actually end up the way the change intended? PASS or FAIL.

Phase: **Verify**. Read-only — the query runs inside `BEGIN TRANSACTION READ ONLY`, so any write (including writable CTEs) is rejected by Postgres, not by string-parsing.

## When to use

- After a write / migration / job, to prove the data is in the expected state.
- As `check-work` DB evidence: "row exists", "count == N", "this column == value".
- Regression gate: assert an invariant still holds after a change.

## When NOT to use

- **Target is a WordPress site** → `rolepod-wplab` owns WP data access; route there.
- You need to *mutate* data → use `/db-write` (guarded). `db-query` refuses writes.
- You just want to browse rows ad hoc → that's a plain `psql` / SQL client job, out of scope (SPEC §3) — `db-query` returns a PASS/FAIL assertion, not a row dump.
- You want a query plan → `/db-explain`.

## Inputs

- `conn` — Postgres connection string (secret; never logged).
- `sql` — a read-only query.
- `expect` — at least one of: `exists` (bool), `row_count` (int), `value` (first column of first row equals this scalar).
- `timeout_ms` *(optional, default 30000)* — statement timeout.

## Process

Call `rolepod_db_query`:

```json
{
  "conn": "postgresql://…/db",
  "sql": "SELECT status FROM orders WHERE id = 42",
  "expect": { "exists": true, "row_count": 1, "value": "paid" }
}
```

## Outputs

- `passed` — true iff every assertion passed.
- `checks[]` — each: `name`, `expected`, `actual`, `passed`.
- `row_count`, `sample` (≤5 rows for context), `manifest_path` (phase `verify`, status `pass`/`fail`).

A write attempt returns an error with code `read_only_violation` (not a PASS, not a silent write).

## Examples

### Prove a migration backfilled a column

```json
{ "conn": "postgresql://…/db", "sql": "SELECT count(*) FROM users WHERE tier IS NULL", "expect": { "value": 0 } }
```

PASS means zero users have a null tier — the backfill is complete.

## Evidence routing

- **Standalone:** `.rolepod-dblab/artifacts/db-query_<ts>_<uuid>/`
- **With `rolepod` parent** (marker `<git-root>/.rolepod/parent-active`): `<git-root>/.rolepod/evidence/<ts>-rolepod-dblab-db-query/`

The run directory holds `assertion.json` + a `manifest.json` (Extension Protocol v1), so `check-work` aggregates DB state as a first-class evidence type.

## If the tool is unavailable

> The `/db-query` skill needs the **rolepod-dblab** MCP server, which is not currently available. Confirm the plugin is installed and try again, or check that `npx -y @rolepod/dblab` is reachable.
