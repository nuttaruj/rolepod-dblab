# Changelog

All notable changes to rolepod-dblab are documented here. This project adheres to [Semantic Versioning](https://semver.org/).

## [0.1.1] — 2026-05-30

Hardening — no behavior change.

### Fixed

- **Connection leak on `BEGIN` failure** (`PgSessionRegistry.open`): if `BEGIN` threw after a successful connect, the `pg` client was never closed. Now wrapped so the connection is ended on failure.
- **Defensive secret redaction** (`tools/result.ts`): the tool failure serializer now scrubs any Postgres connection URI from error messages — a belt-and-suspenders net so a leak can't slip through if a throw site outside the engine's connect path ever carries one. Centralized the scrub as `scrubConnUri` (single source of truth, shared with the engine's connect-error redaction).

## [0.1.0] — 2026-05-29

Initial release — the data-layer limb of the rolepod ecosystem. Postgres-only.

### Added

- **MCP server** (TS/ESM, MCP SDK ^1.29) exposing five `rolepod_db_*` tools; `pg` lazy-loaded via dynamic import.
- **`rolepod_db_introspect`** — schema, columns, types, primary keys, indexes, FK graph, optional row-count estimates → normalized snapshot. Read-only.
- **`rolepod_db_query`** — read-only query (run inside `BEGIN TRANSACTION READ ONLY`) evaluated against `exists` / `row_count` / `value` expectations → structured PASS/FAIL assertion. Writes are rejected (`read_only_violation`).
- **`rolepod_db_explain`** — `EXPLAIN [ANALYZE]` → parsed plan flagging sequential scans and probable missing indexes. Read-only even under `ANALYZE`.
- **`rolepod_db_migrate_verify`** — schema-drift detection between SQLAlchemy models (reflected via the `reflect_models.py` Python sidecar) and the live schema; classes: missing/extra table, missing/extra column, nullability mismatch, type mismatch. Native → snapshot → unverifiable fallback modes.
- **`rolepod_db_write`** — guarded mutation: preview (held transaction, no commit) → confirm (COMMIT) / rollback (ROLLBACK), with idle auto-rollback (default 5 min).
- **CLI** (`bin/rolepod-dblab`): `serve` (default, MCP stdio), `doctor`, `test-connection`.
- **Five skills** (`/db-introspect`, `/db-query`, `/db-explain`, `/db-migrate-verify`, `/db-write`), each encoding the no-overlap boundary (WordPress → wplab; other DBs → dblab).
- **Compose seam**: marker-file detection (`<git-root>/.rolepod/parent-active`) + evidence routing + `manifest.json` per Extension Protocol v1, for `check-work` / `review-code` / `debug-issue` / `finish-work`.
- Per-CLI manifests for Claude Code, Codex, Cursor, and Gemini.

### Decisions (v1)

- **D1** Postgres-only · **D2** SQLAlchemy drift via a Python reflection sidecar · **D3** held-transaction write-guard (core ritual) · **D4** connection-string per call (+ optional vault) · **D5** self-contained reads (no dependency on an external Postgres MCP).
