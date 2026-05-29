---
name: db-migrate-verify
description: Detect schema drift between SQLAlchemy models and the live Postgres — missing/extra columns, nullability mismatches, type mismatches. Reflects the models via a Python sidecar and diffs in TS. Read-only. Use as a pre-ship gate or when "the code says one thing, the DB says another".
---

# /db-migrate-verify

Single-backend skill. Calls **`rolepod_db_migrate_verify`** on the rolepod-dblab MCP server and surfaces the structured result. No fallback (D-001).

> Does the live database actually match what the SQLAlchemy models declare?

Phase: **Ship / Review**. Read-only. The declared schema is reflected by a small Python sidecar (`reflect_models.py`) running in your project interpreter; the TS server owns the diff — the analog of how uiproof shells out to Appium for mobile.

## When to use

- Pre-ship gate: confirm migrations actually applied and the DB matches the models.
- A bug smells like a code/DB mismatch (a column the model expects isn't there, or nullability differs).
- After a migration, to prove it landed with no drift.

## When NOT to use

- **Target is a WordPress site** → `rolepod-wplab`; dblab does not model WP schemas.
- Your ORM is not SQLAlchemy (Prisma / Drizzle / raw migrations) → not supported in v1; supply a `snapshot_path` instead, or skip.
- You want to *generate* or *design* the schema → architect decision; dblab verifies, never designs (SPEC §3).

## Inputs

- `conn` — connection string (secret; never logged).
- `schema` *(optional, default `public`)*.
- `models_entrypoint` — SQLAlchemy models as `module:attr` (a declarative `Base` or `MetaData`), e.g. `app.models:Base`.
- `snapshot_path` *(optional)* — fallback: a pre-generated normalized schema JSON, when the models can't be imported here.
- `project_dir` *(optional)* — directory the sidecar runs in so `models_entrypoint` imports (defaults to the server's working directory).

Native (`models_entrypoint`) is the primary path; `snapshot_path` is the fallback; if neither resolves, the result is **`unverifiable`** with a reason — never a false PASS, and the other four skills are unaffected.

## Process

Call `rolepod_db_migrate_verify`:

```json
{
  "conn": "postgresql://…/db",
  "schema": "public",
  "models_entrypoint": "app.models:Base",
  "project_dir": "/path/to/your/project"
}
```

Requires `python3` + `SQLAlchemy` importable in `project_dir` (run `rolepod-dblab doctor` to check). If missing, pass `snapshot_path` instead.

## Outputs

- `unverifiable` — true if the models couldn't be reflected (with `reason`); status `warn`.
- `passed` — true iff no drift; `drift[]` — each: `class` (`missing_table` | `extra_table` | `missing_column` | `extra_column` | `nullability_mismatch` | `type_mismatch`), `table`, `column?`, `expected` (model), `actual` (db), `detail`.
- `manifest_path` (phase `review`, status `pass` / `fail` / `warn`).

## Examples

### Pre-ship drift gate

```json
{ "conn": "postgresql://…/prod", "models_entrypoint": "app.models:Base", "project_dir": "/srv/app" }
```

`passed: false` with a `missing_column` on `users.tier` → a migration didn't apply; do not ship.

## Evidence routing

- **Standalone:** `.rolepod-dblab/artifacts/db-migrate-verify_<ts>_<uuid>/`
- **With `rolepod` parent** (marker `<git-root>/.rolepod/parent-active`): `<git-root>/.rolepod/evidence/<ts>-rolepod-dblab-db-migrate-verify/`

The run directory holds `drift.json` + a `manifest.json` (Extension Protocol v1), so `finish-work` / `review-code` can use drift as a pre-ship gate.

## If the tool is unavailable

> The `/db-migrate-verify` skill needs the **rolepod-dblab** MCP server, which is not currently available. Confirm the plugin is installed and try again, or check that `npx -y @rolepod/dblab` is reachable.
