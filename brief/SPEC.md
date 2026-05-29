# rolepod-dblab — Specification

> Status: **DRAFT brief** — seeds a fresh build session. Re-run `/write-spec` in the new
> session to pressure-test these decisions before coding. This document is the contract
> the build session starts from, not the final word.

---

## 1. Problem

A code-only agent (Claude Code / Codex / Gemini / Cursor) is blind to the **live data layer**.
It can read migration files and ORM models, but it cannot:

- Prove a migration actually applied to the running DB.
- Assert a row exists with the expected value (verify-phase evidence).
- See a real query plan (perf evidence, not a guess).
- Detect drift between declared schema (code) and actual schema (DB).
- Mutate data safely (no transaction guard, no confirm ritual).

Today this work happens through raw `psql`/`mysql` in `Bash` — **no safety, not reproducible,
not captured as evidence.** `check-work`'s evidence list is literally
`tests, build, typecheck, curl, logs, screenshot, browser` — **DB state is absent.**

dblab is the limb that fills this gap: the **hands + eyes of the data layer**.

---

## 2. What it is

A standalone MCP plugin (mirrors the `rolepod-uiproof` / `rolepod-wplab` pattern) that exposes
`rolepod_db_*` tools and a small set of phase-mapped skills. It runs in any MCP-capable CLI on
its own, and composes into the rolepod workflow by reference when rolepod core is present.

**One-line scope:** a *data-layer safety + truth verifier* — **not** a general SQL client.

---

## 3. Hard scope boundary (the no-overlap contract)

dblab must NOT duplicate anything already in the rolepod ecosystem. The boundary:

| Capability | Owner | dblab? |
|---|---|---|
| Run a raw `SELECT` to look at data | `Bash` + `psql` / off-the-shelf PG MCP | reads exist for standalone completeness, but are NOT the pitch |
| **Safe mutation (INSERT/UPDATE/DELETE) with txn dry-run + confirm** | **nothing** | ✅ core value |
| **Schema drift: live DB vs ORM models / migrations** | **nothing** | ✅ core value |
| **DB state as PASS/FAIL verify-evidence** | **nothing** (raw tools return rows) | ✅ core value |
| Query plan / EXPLAIN as perf evidence | partially manual today | ✅ |
| WordPress DB via WP semantics (options, transients, wpdb) | **rolepod-wplab** | ❌ route by target |
| Hosted DB provision / scale | Railway / Vercel MCP | ❌ |
| Schema *design* decisions | `system-architect` agent | ❌ dblab verifies, never designs |
| Browser / native-mobile UI runtime | **rolepod-uiproof** (web + Appium) | ❌ different runtime |

**wplab seam rule (the one internal touch-point):**
- Target is a **WordPress site** → wplab (it knows WP meaning).
- Target is **any other database** (SaaS backend Postgres, analytics DB) → dblab (raw engine).
- Concrete: Kyni SEO `seo-backend` Postgres → dblab. A WP client site → wplab.

If a proposed feature falls on the wrong side of this table, it does not belong in dblab.

---

## 4. Capabilities (phase-mapped skills)

| Skill | Phase | Job | Default mode |
|---|---|---|---|
| `db-introspect` | Plan / Debug | schema, columns, types, indexes, FK graph, row counts | read-only |
| `db-query` | Verify | safe read → returns a structured PASS/FAIL assertion check-work consumes | read-only |
| `db-explain` | Perf / Review | `EXPLAIN ANALYZE` → query plan as perf evidence | read-only |
| `db-migrate-verify` | Ship / Review | diff **live schema vs ORM models / latest migration** → report drift | read-only |
| `db-write` | Build | guarded mutation — see safety model below | write (guarded) |

### Drift detection mechanism (`db-migrate-verify`) — see §10 for the full decision.

### Safety model (the differentiator vs every existing DB MCP)

`db-write` MUST follow this ritual on every mutation:

1. Open a **transaction** (do not auto-commit).
2. Execute the statement inside the txn.
3. Return a **preview**: statement, affected-row count, and a before/after sample.
4. **Require explicit confirmation** (separate tool call / arg) before commit.
5. On confirm → `COMMIT`. On anything else → `ROLLBACK`.

This is rolepod's "risky actions" core implemented as an actuator. A generic Postgres MCP runs
destructive SQL with no guard — dblab refuses to. This safety-hold-across-tool-calls is the
**technical reason dblab is an MCP plugin and not a prompt-only skill** (a skill cannot hold a
transaction open across turns or truly enforce the confirm gate).

---

## 5. Standalone + compose (mirror uiproof)

**Standalone (no rolepod):** connect with a connection string; introspect / safe-write / drift
all work in any MCP-capable CLI. Value lands without rolepod installed.

**Compose (rolepod present):** rolepod skills reference dblab tools as evidence/gates —
**by reference, never a hard dependency** (same seam as `check-work` "reads browser evidence"
from uiproof):

- `check-work` → DB becomes a first-class evidence type (closes the documented gap).
- `review-code` → on migration / auth / billing paths, auto-escalate calls `db-migrate-verify`.
- `debug-issue` → inspect live data state as a root-cause source.
- `finish-work` → `db-migrate-verify` as a pre-ship gate.

The composition is additive: dblab never blocks or caps anything; rolepod skills opt in.

---

## 6. Open decisions — defaulted (revisit in build-session discovery)

These were defaulted to *simplest viable* aligned with the user's stack. Each is revisable.

| # | Decision | Default (v1) | Rationale | Revisit if |
|---|---|---|---|---|
| D1 | Engine scope | **Postgres only** | User backend is Postgres; simplest viable; avoids multi-driver surface | MySQL/SQLite demand appears early |
| D2 | ORM for drift | **SQLAlchemy via Python sidecar** (see §10) | Kyni backend is Python/SQLAlchemy; sidecar keeps the server TS + isolates Python to the one skill that needs it | a non-Python target is primary |
| D3 | Write-guard depth | **txn dry-run + confirm** (core ritual only) | Covers the risk; extras (rollback snapshot, audit log) are additive later | a compliance/audit need is stated |
| D4 | Connection creds | **connection string per call + optional vault** (wplab-style) | Standalone needs string; vault is convenience | — |
| D5 | Read tooling | dblab ships its own reads (standalone), does **not** depend on an external PG MCP | self-contained; no runtime dependency on another server | — |

---

## 7. Non-goals (v1)

- No schema design / generation (architect agent owns design).
- No DB provisioning, scaling, backup/restore (cloud MCPs own infra).
- No multi-engine (MySQL/SQLite) until PG path is proven.
- No ORM beyond SQLAlchemy for drift in v1.
- No WP-semantic access (wplab owns it).
- No data visualization / BI.

---

## 8. Success criteria (v1 "done")

1. Connect to a live Postgres with a connection string in Claude Code, Codex, Cursor, Gemini.
2. `db-introspect` returns schema + indexes + FK graph for a real DB.
3. `db-query` returns a structured PASS/FAIL assertion (not raw rows).
4. `db-explain` returns a parsed query plan flagging seq scans / missing indexes.
5. `db-migrate-verify` detects at least one real drift class (nullability, missing column, type mismatch) between SQLAlchemy models and live schema.
6. `db-write` performs the full txn → preview → confirm → commit/rollback ritual, proven with a live row mutation + a refused (rolled-back) mutation.
7. Works standalone (no rolepod) and the four rolepod seams in §5 are documented (wiring optional in v1).

---

## 9. Architecture reference

Mirror `rolepod-uiproof` repo layout (local template at
`~/.claude/plugins/marketplaces/rolepod-uiproof/`):

- `bin/rolepod-dblab.ts` — CLI entry (`doctor`, connection test) + MCP server bootstrap.
- MCP server exposing `rolepod_db_*` tools (TS, lazy-load DB drivers like uiproof lazy-loads `webdriverio`).
- `plugins/rolepod-dblab/skills/<skill>/SKILL.md` — the five skills.
- `plugins/rolepod-dblab/.claude-plugin/`, `.codex-plugin/`, `.cursor-plugin/` — per-CLI manifests.
- adapters for claude / codex / cursor / gemini (mirror uiproof multi-CLI rendering).
- `THIRD_PARTY.md`, `CHANGELOG.md`, `tests/`.
- DB drivers: `pg` (v1). Lazy-load. `mysql2` / `better-sqlite3` deferred to D1 revisit.
- `src/drift/reflect_models.py` — the standalone Python sidecar (§10); runs in the user's project
  interpreter, reflects `Base.metadata` → JSON. The only Python in the repo; TS does the diff.

Versioning + caps: follow rolepod conventions (≤190 lines per SKILL.md, ≤5 supporting files per skill).

---

## 10. Drift detection architecture (decided)

**Problem:** the server is TS (mirror uiproof), but the drift target is SQLAlchemy — Python
objects. Reflecting `Base.metadata` (the declared schema) requires a Python interpreter that can
`import` the user's model modules.

**Decision: TS server + Python drift-sidecar (native-primary, snapshot-fallback, graceful-degrade).**

Why, over the alternatives:
- A *full-Python plugin* would also need to import the user's models (same Python requirement) but
  throws away all the TS/uiproof scaffolding (MCP SDK, build, four CLI manifests, adapters) to make
  1 of 5 skills cleaner — a bad trade, and it forks the ecosystem into two plugin architectures.
- A *snapshot-only* approach avoids Python but is not SQLAlchemy-native (fails D2) and the snapshot
  can itself go stale vs the live models.
- The "needs a Python env" cost is **intrinsic** to live-model drift — it is NOT avoided by going
  full-Python; it is only avoided by giving up native drift. So it is not a reason to abandon TS.
- **This is already the uiproof pattern:** uiproof is TS/Playwright for web but shells out to
  Appium + system Xcode/Android SDKs for the mobile capability (lazy-load, `doctor` check, partial
  support). dblab's Python sidecar for drift is the direct analog — TS core, one heavy external
  runtime for one specialized capability. Option 1 *is* mirror-uiproof, not a deviation from it.

How it works:
1. **4 of 5 skills are pure TS** (introspect, query, explain, write). Only `db-migrate-verify`
   touches Python.
2. The sidecar is a small standalone Python script that runs in the **user's project interpreter**
   (invoked as a subprocess, the way uiproof leans on the system Appium/SDKs — dblab does NOT bundle
   its own Python). It takes a models entrypoint (e.g. `app.models:Base`), reflects
   `Base.metadata` → emits a JSON schema → exits.
3. **TS does the diff** — live PG schema (already introspected in TS) vs the JSON the sidecar
   emits. Diff logic is pure data; no SQLAlchemy needed on the TS side.
4. **`doctor` checks** Python availability + that the models entrypoint imports.
5. **Graceful degradation / fallback modes:**
   - models import OK → SQLAlchemy-native drift (D2 primary path).
   - import fails → return `unverifiable` + reason (per check-work "state limitations
     explicitly"); the other 4 skills are unaffected.
   - user supplies a schema snapshot (`alembic upgrade --sql` / JSON) → diff against the snapshot
     (absorbs the snapshot approach as a degraded fallback, no separate design).

Net: Python is isolated to exactly where it is intrinsically required; the server stays TS and
reuses uiproof scaffolding wholesale; the snapshot approach is folded in as a fallback rather than
a competing architecture.
