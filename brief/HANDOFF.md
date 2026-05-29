# rolepod-dblab — Build-session Handoff

> Read this first, then `brief/SPEC.md`. You are starting a fresh repo at
> `/Users/nuttaruj/Project/rolepod-dblab`. Goal: build the `rolepod-dblab` plugin —
> the **data-layer safety + truth verifier** limb of the rolepod ecosystem.

---

## TL;DR

Build a standalone MCP plugin that gives a coding agent **eyes + safe hands on a live database**:
prove migrations applied, assert DB state as verify-evidence, read query plans, detect schema
drift (code vs DB), and mutate data behind a transaction-confirm guard. It must NOT become a
generic SQL client — that overlaps `psql` and off-the-shelf Postgres MCPs and is explicitly out
of scope. The whole spec is in `brief/SPEC.md`; the no-overlap contract is §3 there.

---

## Why this limb exists (context you didn't see)

The rolepod ecosystem already covers these runtimes:

- **code/files** → rolepod core (base CLI)
- **web browser + native mobile (Appium)** → rolepod-uiproof
- **WordPress install** → rolepod-wplab
- **live database** → *nothing* ← this is the gap dblab fills

`check-work`'s evidence list (`tests, build, typecheck, curl, logs, screenshot, browser`) has no
DB modality. dblab adds it. The limb was chosen over a "mobile limb" because uiproof already owns
native mobile via its Appium engine (verified in uiproof source) — building mobile would overlap.

---

## Start sequence (rolepod phases)

1. **`/write-spec`** — do NOT skip. Pressure-test `brief/SPEC.md`:
   - Confirm or change the five defaulted decisions (SPEC §6: D1 Postgres-only, D2 SQLAlchemy,
     D3 core write-guard, D4 conn-string+vault, D5 self-contained reads).
   - Lock the success criteria (SPEC §8) as the acceptance contract.
2. **`/write-plan`** — ordered tasks, file list, test plan. Suggested task spine:
   - T1: repo scaffold mirroring `~/.claude/plugins/marketplaces/rolepod-uiproof/` layout.
   - T2: MCP server bootstrap + `bin/rolepod-dblab.ts doctor` + Postgres connect (lazy-load `pg`).
   - T3: `db-introspect` (read schema/indexes/FK).
   - T4: `db-query` → structured PASS/FAIL assertion shape.
   - T5: `db-explain` → parsed plan, flag seq-scan / missing index.
   - T6: `db-migrate-verify` → drift via **TS + Python sidecar** (SPEC §10). Python script
     (`src/drift/reflect_models.py`) runs in the user's interpreter, reflects `Base.metadata` →
     JSON; TS diffs vs live schema. Start with nullability + missing-column + type-mismatch
     classes. Native-primary, snapshot-fallback, graceful-degrade (the other 4 skills never depend
     on Python).
   - T7: `db-write` → the full txn → preview → confirm → commit/rollback ritual (SPEC §4).
   - T8: per-CLI manifests (claude/codex/cursor/gemini) + adapters.
   - T9: docs (THIRD_PARTY.md, CHANGELOG.md, README) + the four rolepod compose-seam notes (SPEC §5).
3. **`/implement-plan`** — TDD the risky paths (write-guard, drift diff). Surgical edits.
4. **`/check-work`** — prove §8 success criteria with a live Postgres (a throwaway local PG is fine).
5. **`/review-code`** — security-engineer tier on the write-guard path (it touches data integrity).

---

## Architecture template

Clone the shape of `rolepod-uiproof` (local: `~/.claude/plugins/marketplaces/rolepod-uiproof/`):

```
rolepod-dblab/
  bin/rolepod-dblab.ts          # CLI: doctor, connect-test; MCP bootstrap
  src/                          # MCP server, engine adapters, drift differ, write-guard
  plugins/rolepod-dblab/
    skills/<skill>/SKILL.md      # 5 skills (≤190 lines each, ≤5 support files)
    .claude-plugin/ .codex-plugin/ .cursor-plugin/
  adapters/                     # claude / codex / cursor / gemini rendering
  tests/
  THIRD_PARTY.md CHANGELOG.md README.md
```

Tool namespace: `rolepod_db_*` (e.g. `rolepod_db_introspect`, `rolepod_db_query`,
`rolepod_db_explain`, `rolepod_db_migrate_verify`, `rolepod_db_write`).

DB driver: `pg` only in v1, lazy-loaded (uiproof lazy-loads `webdriverio` the same way).

Drift: server stays TS; one Python sidecar (`src/drift/reflect_models.py`) runs in the user's
project interpreter for SQLAlchemy reflection — the direct analog of how uiproof shells out to
Appium/SDKs for mobile. 4/5 skills are pure-TS. Full rationale + fallback modes in SPEC §10.

---

## Guardrails — do not violate

- **No-overlap contract** (SPEC §3) is load-bearing. Every feature must pass the boundary table.
  If it looks like a generic SQL client feature, stop.
- **db-write safety ritual is non-negotiable** — transaction, preview, explicit confirm, then
  commit/rollback. This is the reason the limb is a plugin, not a skill.
- **Standalone first** — every tool must work without rolepod core installed. rolepod composition
  is by-reference and optional.
- **Read-only by default** — only `db-write` mutates, and only behind the guard.
- **dblab verifies, never designs** schema. Architecture decisions belong to the architect agent.
- Follow rolepod caps: ≤190 lines per SKILL.md, ≤5 supporting files per skill.

---

## Open questions to raise with the user in the new session

- D1: confirm Postgres-only for v1, or want MySQL/SQLite in scope now?
- D2: drift architecture is decided (TS + Python sidecar, SPEC §10). Confirm SQLAlchemy as the
  v1 ORM target, or another (Prisma/Drizzle/Alembic-migrations) — note non-Python ORMs would not
  need the Python sidecar.
- D3: is core write-guard enough for v1, or is an audit-log / rollback-snapshot needed day one?
- Repo: new GitHub repo `nuttaruj/rolepod-dblab` + marketplace entry like the other children?

---

## Parent-repo note

This limb lives in its own repo (like rolepod-uiproof / rolepod-wplab). When it ships, add a row
to the parent `rolepod` README "Other recommended add-ons" / child-plugin section and document the
four compose seams. Do that in the parent repo, not here.
