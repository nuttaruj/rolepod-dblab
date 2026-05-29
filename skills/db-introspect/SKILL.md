---
name: db-introspect
description: Read a live Postgres schema — tables, columns, types, primary keys, indexes, and the foreign-key graph — into a normalized snapshot for planning and debugging. Read-only. Use before changing data access, writing a migration, or reasoning about how tables relate.
---

# /db-introspect

Single-backend skill. Calls **`rolepod_db_introspect`** on the rolepod-dblab MCP server and surfaces the structured result. No fallback (D-001).

> What does the live schema actually look like — tables, columns, types, indexes, foreign keys?

Phase: **Plan / Debug**. Read-only.

## When to use

- Before writing or reviewing a migration — see the real shape, not just the model file.
- Planning a query or data-access change and you need the FK graph + indexes.
- Debugging "why is this column null / missing" against the running database.

## When NOT to use

- **Target is a WordPress site** → use `rolepod-wplab` (`/wp-introspect`), not dblab. wplab understands WP-semantic structure (options, post meta, taxonomies); `db-introspect` returns raw tables/columns/FKs with no WP meaning. (No-overlap contract, SPEC §3.)
- You want WP options / transients / `wpdb` semantics → `rolepod-wplab`.
- You want to *design* a schema → that is an architect decision; dblab verifies, never designs.
- You want to provision / scale / back up a database → a cloud MCP (Railway / Vercel), not dblab.

## Inputs

- `conn` — Postgres connection string (`postgresql://…`). Treated as a secret; never logged.
- `schema` *(optional, default `public`)* — schema to introspect.
- `include_row_counts` *(optional, default false)* — add estimated row counts (`pg_class.reltuples`; cheap, not exact).

## Process

Call `rolepod_db_introspect`:

```json
{
  "conn": "postgresql://user:pass@host:5432/db",
  "schema": "public",
  "include_row_counts": false
}
```

## Outputs

- `table_count` — number of base tables in the schema.
- `tables[]` — each: `name`, `columns[]` (`name`, `type`, `nullable`, `default`, `primaryKey`), `indexes[]` (`name`, `columns`, `unique`), `foreignKeys[]` (`name`, `columns`, `refTable`, `refColumns`), `rowCount`.
- `manifest_path` — Extension Protocol v1 manifest (phase `debug`).

## Examples

### Map a schema before a migration

User: "What does the orders schema look like before I touch it?"

```json
{ "conn": "postgresql://…/shop", "schema": "public", "include_row_counts": true }
```

Surface the FK graph and indexes; flag any table the migration will touch.

## Evidence routing

Run artifacts are saved under:

- **Standalone:** `.rolepod-dblab/artifacts/db-introspect_<ts>_<uuid>/`
- **With `rolepod` parent** (detected via the marker file `<git-root>/.rolepod/parent-active` written by the parent's SessionStart hook): `<git-root>/.rolepod/evidence/<ts>-rolepod-dblab-db-introspect/`

Either way the run directory contains `schema.json` plus a `manifest.json` per Extension Protocol v1, so the parent's `check-work` / `debug-issue` skills can read the live schema as evidence.

## If the tool is unavailable

> The `/db-introspect` skill needs the **rolepod-dblab** MCP server, which is not currently available. Confirm the plugin is installed and try again, or check that `npx -y @rolepod/dblab` is reachable.
