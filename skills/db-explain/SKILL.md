---
name: db-explain
description: Run EXPLAIN [ANALYZE] on a query and return the parsed plan with flags for sequential scans and probable missing indexes — performance evidence, not a guess. Read-only. Use when a query is slow or before shipping a query-heavy path.
---

# /db-explain

Single-backend skill. Calls **`rolepod_db_explain`** on the rolepod-dblab MCP server and surfaces the structured result. No fallback (D-001).

> Is this query going to scan a whole table? Where is an index missing?

Phase: **Perf / Review**. Read-only — EXPLAIN runs inside a READ ONLY transaction, so even `ANALYZE` (which executes the query) cannot mutate.

## When to use

- A query is slow and you want the real plan, not a hypothesis.
- Reviewing a query-heavy change before merge.
- Confirming an index you added is actually used.

## When NOT to use

- **Target is a WordPress site** → `rolepod-wplab` for WP query concerns.
- You want to assert data state → `/db-query`. You want to mutate → `/db-write`.
- You want to *add* the index → that's a migration/write; dblab flags the need, it does not redesign the schema (SPEC §3).

## Inputs

- `conn` — connection string (secret; never logged).
- `sql` — the query to analyze.
- `analyze` *(optional, default false)* — use `EXPLAIN ANALYZE` (executes the query to get real timings; still read-only).

## Process

Call `rolepod_db_explain`:

```json
{ "conn": "postgresql://…/db", "sql": "SELECT * FROM events WHERE kind = 'a'", "analyze": false }
```

## Outputs

- `has_concerns` — true if any probable-missing-index flag fired.
- `flags[]` — each: `kind` (`seq_scan` | `possible_missing_index`), `relation`, `plan_rows`, `filter?`, `detail`.
- `plan` — the raw parsed JSON plan; `manifest_path` (phase `review`, status `warn` when concerns, else `pass`).

## Examples

### Find the missing index behind a slow filter

```json
{ "conn": "postgresql://…/db", "sql": "SELECT * FROM events WHERE kind = 'signup'" }
```

A `possible_missing_index` flag on `events` with the filter on `kind` → consider `CREATE INDEX … ON events(kind)`.

## Evidence routing

- **Standalone:** `.rolepod-dblab/artifacts/db-explain_<ts>_<uuid>/`
- **With `rolepod` parent** (marker `<git-root>/.rolepod/parent-active`): `<git-root>/.rolepod/evidence/<ts>-rolepod-dblab-db-explain/`

The run directory holds `plan.json` + a `manifest.json` (Extension Protocol v1), so `review-code` can read the plan as performance evidence.

## If the tool is unavailable

> The `/db-explain` skill needs the **rolepod-dblab** MCP server, which is not currently available. Confirm the plugin is installed and try again, or check that `npx -y @rolepod/dblab` is reachable.
