# rolepod-dblab

**Data-layer safety + truth verifier for AI coding agents.** An MCP server that gives a coding agent *eyes + safe hands on a live database*: prove a migration applied, assert DB state as verify-evidence, read query plans, detect schema drift (code vs DB), and mutate data behind a transaction-confirm guard.

It is **not** a generic SQL client. Running ad-hoc `SELECT`s belongs to `psql` or an off-the-shelf Postgres MCP. dblab's value is the things nothing else does safely: **guarded mutation, schema-drift detection, and DB state as PASS/FAIL evidence.**

dblab is the **data-layer limb** of the [rolepod](https://github.com/nuttaruj) ecosystem, alongside `rolepod-uiproof` (web/mobile UI) and `rolepod-wplab` (WordPress). v1 is Postgres-only.

---

## The five tools / skills

| Skill | Tool | Phase | What it does |
|---|---|---|---|
| `/db-introspect` | `rolepod_db_introspect` | Plan / Debug | Schema, columns, types, indexes, FK graph, row-count estimates → normalized snapshot. Read-only. |
| `/db-query` | `rolepod_db_query` | Verify | Run a read-only query (inside `BEGIN TRANSACTION READ ONLY`) and return a structured **PASS/FAIL** assertion — not raw rows. |
| `/db-explain` | `rolepod_db_explain` | Perf / Review | `EXPLAIN [ANALYZE]` → parsed plan flagging sequential scans and probable missing indexes. |
| `/db-migrate-verify` | `rolepod_db_migrate_verify` | Ship / Review | Diff **SQLAlchemy models vs live schema** → drift report (missing/extra column, nullability, type mismatch). |
| `/db-write` | `rolepod_db_write` | Build | Guarded mutation: **preview → confirm → commit/rollback**. The only tool that writes. |

### The write-guard ritual (the differentiator)

`db-write` never writes without an explicit confirm. It holds a transaction open across tool calls:

1. **preview** → `BEGIN`, run the statement inside the transaction, return affected-row count + an optional before/after sample + a `txn_id`. **Nothing is committed.**
2. **confirm** → `COMMIT` (needs the `txn_id`).
3. **rollback** → `ROLLBACK`. An abandoned transaction auto-rolls-back after the idle timeout (default 5 min, `ROLEPOD_DBLAB_TXN_IDLE_MS`).

Holding a transaction open across turns is why dblab is an MCP plugin and not a prompt-only skill — a skill cannot enforce the confirm gate.

---

## Quickstart (standalone)

dblab works in any MCP-capable CLI with just a connection string — no rolepod core required.

```bash
# Health check (Node, pg, python3 + SQLAlchemy for drift)
npx -y @rolepod/dblab doctor

# Smoke-test a connection
npx -y @rolepod/dblab test-connection "postgresql://user:pass@localhost:5432/mydb"
```

Register the MCP server (the repo ships per-CLI manifests):

- **Claude Code / generic MCP:** `.mcp.json` → `npx -y @rolepod/dblab`
- **Codex:** `.codex-plugin/plugin.json`
- **Cursor:** `.cursor-plugin/plugin.json`
- **Gemini CLI:** `gemini-extension.json`

`pg` is a hard dependency (every skill except drift needs it). `python3` + `SQLAlchemy` are needed **only** for `/db-migrate-verify`; the other four skills work without them.

### Schema drift (`/db-migrate-verify`)

The dblab server is TypeScript and can't import Python objects in-process, so it shells out to a tiny Python sidecar (`reflect_models.py`) that reflects your SQLAlchemy `Base.metadata` → JSON; the TS server owns the diff. This is the direct analog of how `rolepod-uiproof` shells out to Appium for the mobile runtime it can't reach natively.

```jsonc
// /db-migrate-verify
{ "conn": "postgresql://…/db", "models_entrypoint": "app.models:Base", "project_dir": "/path/to/project" }
```

Fallback modes: **native** (reflect the models) → **snapshot** (`snapshot_path` to a pre-generated JSON) → **unverifiable** (clear reason, never a false PASS).

---

## Scope boundary (no-overlap)

dblab deliberately does **not** duplicate the rest of the ecosystem:

| Capability | Owner |
|---|---|
| Safe mutation (txn preview → confirm), schema drift, DB state as PASS/FAIL | **dblab** ✅ |
| WordPress DB via WP semantics (options, transients, `wpdb`) | **rolepod-wplab** |
| Browser / native-mobile UI runtime | **rolepod-uiproof** |
| Schema *design* decisions | the architect agent (dblab verifies, never designs) |
| DB provisioning / scaling / backup | a cloud MCP (Railway / Vercel) |

**Routing seam:** target is a **WordPress site** → `wplab`; **any other database** (SaaS backend Postgres, analytics DB) → `dblab`.

---

## Compose with rolepod (by reference, optional)

When the parent `rolepod` plugin is present (detected via the marker file `<git-root>/.rolepod/parent-active`), dblab routes evidence to `<git-root>/.rolepod/evidence/` with a `manifest.json` per Extension Protocol v1. The composition is **additive — dblab never blocks or caps anything; rolepod skills opt in:**

- **`check-work`** → DB becomes a first-class evidence type: `/db-query` PASS/FAIL closes the gap in its evidence list (`tests, build, typecheck, curl, logs, screenshot, browser, …, DB`).
- **`review-code`** → on migration / auth / billing paths, escalate to `/db-migrate-verify`.
- **`debug-issue`** → inspect live data state (`/db-introspect`, `/db-query`) as a root-cause source.
- **`finish-work`** → `/db-migrate-verify` as a pre-ship drift gate.

Standalone is the default; the four seams above are documented integration points, wiring is optional in v1.

---

## Development

```bash
npm install
npm run build       # tsup → dist/ + JSON-schema export
npm run typecheck   # tsc --noEmit
npm test            # vitest (integration tests need Docker for a throwaway Postgres)
```

See [CHANGELOG.md](./CHANGELOG.md) and [THIRD_PARTY.md](./THIRD_PARTY.md). MIT licensed.
