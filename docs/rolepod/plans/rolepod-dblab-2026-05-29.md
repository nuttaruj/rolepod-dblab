# rolepod-dblab Plan

**Goal:** Build the `rolepod-dblab` MCP plugin — a standalone data-layer safety + truth verifier (introspect / query-as-evidence / EXPLAIN / schema-drift / guarded safe-write) that mirrors the `rolepod-uiproof` template and composes into rolepod by-reference.

**Architecture:** TS/ESM MCP server (tsup → `dist/`, MCP SDK `^1.29`, `pg` lazy-loaded via dynamic import). Five `rolepod_db_*` tools follow the `ToolModule<Shape>` pattern; only `db-write` holds state — a `pg` connection + open transaction kept across tool calls in a `PgSessionRegistry` with idle auto-rollback (the technical reason dblab is a plugin, not a skill). Schema-drift uses a Python sidecar (`reflect_models.py`) that reflects SQLAlchemy `Base.metadata` → JSON; the TS server owns the diff — the direct analog of how uiproof shells to Appium for mobile.

**Stack:** `@modelcontextprotocol/sdk`, `zod`, `pg`, `tsup`, `vitest`, Node ≥20, Python 3 + SQLAlchemy (drift sidecar only, user's interpreter).

---

## Source spec
`brief/SPEC.md` (locked) — 5 decisions D1–D5, §8 = 7-criterion acceptance contract, §10 = drift architecture. Template recon: `~/.claude/plugins/marketplaces/rolepod-uiproof/`.

## Locked decisions carried into this plan
- **D1** Postgres-only v1. **D2** SQLAlchemy drift via TS + Python sidecar. **D3** held-txn write-guard, core ritual only. **D4** conn-string per call (+ optional vault, non-blocking). **D5** self-contained reads, no external PG MCP.
- **Resolved (plan-level):** `pg` is a strict **`dependencies`** (not optional like uiproof's webdriverio — 4/5 skills need it; `doctor` must `fail` if missing), still lazy-loaded via `loadPg()`. **Flat `src/tools/`** (no atomic/composite split — only 5 tools). **CLI breadth:** ship 4 manifests; live-verify Claude + Codex; schema-validate Cursor + Gemini. **SKILL.md cap:** target ≤190 lines, hard ceiling 210 (uiproof's real max).

## Files to touch
**Build/config**
- `package.json` — `@rolepod/dblab`, bin `rolepod-dblab`, `type:module`, scripts, deps (`pg` in dependencies), `files[]` incl. `src/drift/reflect_models.py`.
- `tsup.config.ts` — entries `{index, bin/rolepod-dblab}`, esm/node20, `external:[all deps]`.
- `tsconfig.json`, `vitest.config.ts`, `.gitignore` — mirror uiproof verbatim.
- `scripts/export-schemas.mjs` — import `dist/index.js`, `zodToJsonSchema` the 5 schemas → `dist/schemas/tools.json`.

**Server core**
- `bin/rolepod-dblab.ts` — CLI dispatch: `serve`(default)/`doctor`/`test-connection`/`--version`/`--help`; stdio bootstrap + SIGINT/SIGTERM.
- `src/index.ts` — exports `SERVER_NAME`, `SERVER_VERSION`, `ToolNames`, all `*Schema`.
- `src/server.ts` — `buildServer(opts)→ServerHandle{mcp,engine,registry,store,shutdown()}`, registerTool loop.
- `src/errors.ts` — `RolepodMcpError(code,message)`.
- `src/tools/types.ts` — `ToolModule<Shape>`, `ToolContext={engine,registry,store}`.
- `src/tools/result.ts` — `ok()`, `failure(code,message,detail?)`, `safeHandler()`.
- `src/tools/metadata.ts` — `toolMetadata` (title + annotations per tool).
- `src/tools/index.ts` — `tools[]` array.

**Engine / session**
- `src/engine/PgEngine.ts` — Postgres engine (single impl): `loadPg()` lazy dynamic import, `connect`/`introspectSchema`/`runQuery`/`explain`/`disconnect`. **No `DbEngine` interface, no factory** — D1 is Postgres-only with one impl, so an interface+factory is ceremony (decision-protocol: reject "might need later"); revisit only when MySQL actually lands (D1 revisit).
- `src/session/PgSession.ts` — `PgSession` type `{id,client,tx,lastActivity}`.
- `src/session/PgSessionRegistry.ts` — held-txn registry + idle auto-rollback sweep.

**Tools**
- `src/tools/db_introspect.ts`, `db_query.ts`, `db_explain.ts`, `db_migrate_verify.ts`, `db_write.ts`.
- `src/schema/tools.ts` — `<tool>Shape`/`Schema`/`Input` for all 5.

**Drift**
- `src/drift/reflect_models.py` — sidecar: reflect `Base.metadata` → normalized JSON.
- `src/drift/sidecar.ts` — `reflectModels()`: spawn python3, parse, fallback modes.
- `src/drift/normalize.ts` — `normalizeLiveSchema()`: map `PgEngine.introspectSchema` output (reuse T4, no re-query) → normalized shape.
- `src/drift/differ.ts` — `diffSchemas()→DriftFinding[]`, classify drift.

**Evidence / compose-seam**
- `src/artifact/ArtifactStore.ts` — dual-mode routing + `startRun(skill)`.
- `src/util/manifest.ts` — `Manifest` type + `writeManifest()` (Extension Protocol v1).
- `src/util/rolepodProtocol.ts` — `detectRolepodParent(cwd)` marker check.
- `src/cli/doctor.ts` — `runDoctor()` checks.

**Skills / manifests / docs**
- `plugins/rolepod-dblab/skills/{db-introspect,db-query,db-explain,db-migrate-verify,db-write}/SKILL.md`.
- `.claude-plugin/{marketplace.json,plugin.json}`, `.codex-plugin/plugin.json`, `.cursor-plugin/{marketplace.json,plugin.json}`, `gemini-extension.json`, `.mcp.json`.
- `README.md`, `THIRD_PARTY.md`, `CHANGELOG.md`, `LICENSE`.

**Tests**
- `tests/smoke/mcp_handshake.mjs`, `tests/unit/*.test.ts`, `tests/integration/*.test.ts`.

## Tasks

### Task 1: Repo scaffold + build pipeline boots
- [ ] **Files:** `package.json`, `tsup.config.ts`, `tsconfig.json`, `vitest.config.ts`, `.gitignore`, `src/index.ts` (stub: `SERVER_NAME`/`SERVER_VERSION="0.1.0"`/empty `ToolNames`), `src/errors.ts`.
- [ ] **Change:** Mirror uiproof build config. `pg` in `dependencies`; `files[]` includes `src/drift/reflect_models.py`; scripts `build`/`build:schemas`/`typecheck`/`test`.
- [ ] **Test / evidence:** `npm i && npm run build && npm run typecheck` green; `node dist/bin/rolepod-dblab.js --version` → `0.1.0`.
- [ ] **Command:** `npm run build && npm run typecheck`
- **Owner:** backend-developer
- **Done when:** `dist/` produced, typecheck clean, `--version` prints.

### Task 2: MCP server bootstrap + stdio handshake + doctor
- [ ] **Files:** `bin/rolepod-dblab.ts`, `src/server.ts`, `src/tools/types.ts`, `src/tools/result.ts`, `src/tools/metadata.ts`, `src/tools/index.ts` (empty `tools=[]`), `src/cli/doctor.ts`, `tests/smoke/mcp_handshake.mjs`.
- [ ] **Change:** `buildServer` with registerTool loop over empty array; CLI dispatch; `doctor` checks Node≥20, pg-importable (**fail** if missing), python3 (warn), SQLAlchemy (warn).
- [ ] **Test / evidence:** Smoke: boot over stdio, send MCP `initialize`, assert `serverInfo{name,version}` + `tools/list`→`[]`. `rolepod-dblab doctor` exits 0 with pg ok.
- [ ] **Command:** `npm run smoke:mcp && node dist/bin/rolepod-dblab.js doctor`
- **Owner:** backend-developer
- **Done when:** Handshake passes; doctor exit 0. (Proves riskiest infra assumption early.)

### Task 3: PgEngine + lazy-load pg + connection (stateless)
- [ ] **Files:** `src/engine/PgEngine.ts`; instantiate a `PgEngine` directly into `ToolContext` + `buildServer` (no interface, no factory). Optional: vault alias→conn-string resolve (non-blocking).
- [ ] **Change:** `loadPg()` dynamic-import (verbatim pattern from card, install-guidance on failure). Connect via conn-string; `runQuery`; `introspectSchema` (information_schema/pg_catalog); `explain`. Add `test-connection <connstr>` subcommand. `ToolContext.engine: PgEngine` (concrete type, single impl).
- [ ] **Test / evidence:** Integration vs throwaway PG (docker `postgres:16`): connect + `SELECT 1` → server version. Unit: `loadPg` throws guided error when pg absent (mocked).
- [ ] **Command:** `vitest run tests/integration/engine.test.ts`
- **Owner:** backend-developer
- **Done when:** `test-connection` returns PG version; integration green.

### Task 4: db-introspect (manifest phase `debug`) + evidence plumbing
- [ ] **Files:** `src/schema/tools.ts` (`dbIntrospectShape/Schema/Input`), `src/tools/db_introspect.ts`, `src/artifact/ArtifactStore.ts`, `src/util/manifest.ts`, `src/util/rolepodProtocol.ts`; register in `tools[]`+`metadata`+`index.ts`.
- [ ] **Change:** `engine.introspectSchema`→ tables/columns/types/indexes/FK graph/row counts. Build dual-mode evidence routing + `writeManifest` (Extension Protocol v1, `phase:'debug'`). `readOnlyHint:true`.
- [ ] **Test / evidence:** Integration: seed 2 tables + FK + index → assert introspect returns the FK edge + index + column types; assert `manifest.json` written with `protocol:'rolepod/v1'`.
- [ ] **Command:** `vitest run tests/integration/introspect.test.ts`
- **Owner:** backend-developer
- **Done when:** §8#2 — schema+indexes+FK returned for real DB; manifest emitted.

### Task 5: db-query → structured PASS/FAIL assertion (phase `verify`)
- [ ] **Files:** `src/schema/tools.ts` (`dbQueryShape`: `sql`, `expect:{exists?,count?,value?,rows?}`, `timeout_ms`), `src/tools/db_query.ts`; register.
- [ ] **Change:** Run the query inside `BEGIN TRANSACTION READ ONLY` then `ROLLBACK` — Postgres rejects any data-modifying statement at the engine level (incl. writable CTEs `WITH … (INSERT/UPDATE/DELETE)`, side-effecting functions), far more robust than string-parsing for `SELECT`. Same "let the DB enforce" philosophy as the write-guard. Evaluate result vs `expect` → `{passed, assertion, actual, expected}` envelope, NOT raw rows. `writeManifest(phase:'verify')`.
- [ ] **Test / evidence:** Integration: (a) seed row → PASS when matches, FAIL when not; (b) a writable-CTE / data-modifying statement → engine rejects with a read-only-transaction error (NOT a PASS, NOT a silent write); (c) output is assertion shape, not raw rows.
- [ ] **Command:** `vitest run tests/integration/query.test.ts`
- **Owner:** backend-developer
- **Done when:** §8#3 — returns structured PASS/FAIL assertion.

### Task 6: db-explain → parsed plan + flags (phase `review`)
- [ ] **Files:** `src/schema/tools.ts` (`dbExplainShape`: `sql`, `analyze?`), `src/tools/db_explain.ts`; register.
- [ ] **Change:** Run `EXPLAIN (FORMAT JSON)` / `EXPLAIN ANALYZE`; parse plan tree; flag `Seq Scan` on non-trivial tables + missing-index hints. `writeManifest(phase:'review')`.
- [ ] **Test / evidence:** Integration: query unindexed column → flags seq-scan; add index → flag clears.
- [ ] **Command:** `vitest run tests/integration/explain.test.ts`
- **Owner:** backend-developer
- **Done when:** §8#4 — parsed plan flagging seq scans / missing indexes.

### Task 7: db-write held-txn write-guard (phase `build`) — TDD, HIGH-RISK
- [ ] **Files:** `src/session/PgSession.ts`, `src/session/PgSessionRegistry.ts`, `src/schema/tools.ts` (`dbWriteShape`: `conn`, `statement`, `mode:'preview'|'confirm'|'rollback'`, `txn_id?`), `src/tools/db_write.ts`; wire `registry` into `ToolContext`+`buildServer.shutdown`; `metadata` `destructiveHint:true`.
- [ ] **Change:** `mode:'preview'` → connect+`BEGIN`+execute+capture affected-rows + before/after sample, hold session, return `txn_id` (NO commit). `'confirm'`→`COMMIT`+close. `'rollback'`→`ROLLBACK`+close. Idle sweep auto-`ROLLBACK` (default **5min** to bound held row locks, env-configurable `ROLEPOD_DBLAB_TXN_IDLE_MS`, interval `max(30s, timeout/4)`, timer `unref()`). The db-write SKILL (T9) must warn that an unconfirmed preview holds row locks until confirm/rollback/timeout.
- [ ] **Test / evidence (tests-first):** Integration: (a) preview returns rowcount+sample, 2nd connection confirms row UNCHANGED; (b) confirm → row changed; (c) refused/no-confirm → row unchanged; (d) idle timeout auto-rolls-back.
- [ ] **Expected failing signal:** before impl, preview test fails — row IS already mutated (no txn isolation) or `txn_id` undefined.
- [ ] **Command:** `vitest run tests/integration/write_guard.test.ts`
- **Owner:** backend-developer → **security-engineer review** (data integrity).
- **Done when:** §8#6 — full ritual proven for both committed mutation AND refused (rolled-back) mutation.

### Task 8: db-migrate-verify drift (phase `review`) — TDD, cross-language
- [ ] **Files:** `src/drift/reflect_models.py`, `src/drift/sidecar.ts`, `src/drift/normalize.ts`, `src/drift/differ.ts`, `src/schema/tools.ts` (`dbMigrateVerifyShape`: `conn`, `models_entrypoint?`, `snapshot_path?`), `src/tools/db_migrate_verify.ts`; register.
- [ ] **Change:** `reflect_models.py` reflects `Base.metadata`→normalized JSON (tables/columns{name,type,nullable,default,pk}/indexes/fks), nonzero-exit+stderr on import fail. `normalize.ts` maps the **existing `PgEngine.introspectSchema` output (from T4) into the normalized shape — do NOT re-query the live schema (DRY)**. `sidecar.ts reflectModels()`: native-primary → snapshot-fallback (`snapshot_path`) → graceful-degrade (`{unverifiable:true,reason}`). `differ.diffSchemas()` classes: `missing_table|missing_column|extra_column|nullability_mismatch|type_mismatch|fk_mismatch|index_mismatch`.
- [ ] **Test / evidence (tests-first):** Unit `differ`: two normalized schemas differing by nullability + missing-col + type → assert 3 classes detected. Integration: sidecar reflects sample model, diff vs intentionally-drifted live PG → ≥1 class. Fallback: bad entrypoint → `{unverifiable,reason}`, no throw, other skills unaffected.
- [ ] **Expected failing signal:** before impl, differ test returns `[]` for known-drifted pair.
- [ ] **Command:** `vitest run tests/unit/differ.test.ts tests/integration/drift.test.ts`
- **Owner:** backend-developer → qa-tester (test depth).
- **Done when:** §8#5 — detects nullability + missing-column + type-mismatch; graceful-degrade proven.

### Task 9: Five SKILL.md (≤190 target / 210 ceiling)
- [ ] **Files:** `plugins/rolepod-dblab/skills/{db-introspect,db-query,db-explain,db-migrate-verify,db-write}/SKILL.md`.
- [ ] **Change:** Ordered sections — frontmatter(name,description) → When-to-use → When-NOT → Inputs → Process(exact `rolepod_db_*` call JSON) → Outputs → Examples → Evidence routing(standalone `.rolepod-dblab/artifacts/` + parent seam `<git-root>/.rolepod/parent-active`→`.rolepod/evidence/`) → "If tool unavailable" fallback. **When-NOT must encode the no-overlap boundary (SPEC §3) so an agent routes correctly at runtime: target is a WordPress site → wplab, not dblab; WP-semantic data (options/transients/wpdb) → wplab; `db-introspect` = raw table/column/FK introspection vs wplab `wp-introspect` = WP-semantic.** Include `Single-backend skill. Calls rolepod_db_* … No fallback (D-001)`. The db-write SKILL documents the preview→confirm→rollback 3-mode ritual + the held-lock warning (T7).
- [ ] **Test / evidence:** `wc -l` each ≤210; grep each names its `rolepod_db_*` tool + has all 9 sections + the parent-marker seam text.
- [ ] **Command:** `bash tests/skills_lint.sh`
- **Owner:** content-strategist (audience: dev)
- **Done when:** §8#7 (partial) — 5 SKILL.md within caps, sections ordered, seam documented.

### Task 10: Four CLI manifests + .mcp.json + schema export
- [ ] **Files:** `.claude-plugin/{marketplace.json,plugin.json}`, `.codex-plugin/plugin.json`, `.cursor-plugin/{marketplace.json,plugin.json}`, `gemini-extension.json`, `.mcp.json`, `scripts/export-schemas.mjs`.
- [ ] **Change:** All MCP entries → `npx -y @rolepod/dblab`. Descriptions mention standalone + parent-marker seam. `export-schemas.mjs` writes `dist/schemas/tools.json` for the 5 tools.
- [ ] **Test / evidence:** Each manifest parses + required fields present; `npm run build:schemas` → `dist/schemas/tools.json` lists 5 tools. **Live:** register in Claude Code + Codex, `tools/list` shows 5 `rolepod_db_*`. Cursor/Gemini: schema-validate only.
- [ ] **Command:** `node -e "JSON.parse(...)" per manifest && npm run build:schemas`
- **Owner:** backend-developer
- **Done when:** §8#1 — connect verified in Claude + Codex; 4 manifests valid; schemas exported.

### Task 11: Docs + 4 rolepod compose-seam notes
- [ ] **Files:** `README.md`, `THIRD_PARTY.md`, `CHANGELOG.md`, `LICENSE`.
- [ ] **Change:** README: 5 tools + standalone quickstart (conn-string) + the 4 seams (§5): `check-work`→DB evidence, `review-code`→`db-migrate-verify` on migration/auth/billing, `debug-issue`→data state, `finish-work`→migrate-verify gate. THIRD_PARTY: `pg`/`@modelcontextprotocol/sdk`/`zod` + Python SQLAlchemy note. CHANGELOG: `0.1.0`.
- [ ] **Test / evidence:** Doc-lint: README documents all 5 tools + standalone path + names all 4 seams; THIRD_PARTY covers every runtime dep.
- [ ] **Command:** `bash tests/docs_lint.sh`
- **Owner:** content-strategist (audience: dev)
- **Done when:** §8#7 — docs complete, 4 seams documented (wiring optional in v1).

## Spec-coverage trace (§8)
- #1 connect 4 CLIs → T2 (connect) + T10 (manifests, Claude+Codex live)
- #2 introspect → T4 · #3 query PASS/FAIL → T5 · #4 explain flags → T6
- #5 drift → T8 · #6 write ritual → T7
- #7 standalone + 4 seams documented → T9 + T10 + T11
All 7 covered. No orphan requirements.

## High-risk surfaces touched
- **Data mutation (db-write, T7):** held transaction across tool calls → idle auto-rollback + explicit confirm gate. Requires security-engineer review (data integrity, lingering-lock, idempotency).
- **Cross-language trust boundary (T8):** TS spawns Python sidecar; untrusted import path. Sidecar runs in user's interpreter — validate/escape `models_entrypoint`, never `eval`. graceful-degrade on failure (no false PASS).
- **Connection strings (D4):** secrets in args — never log conn-string; redact in errors/manifests.

## Parallel layout
**Sequential — single owner (backend-developer) for T1→T8.** T4–T8 all append to the same 4 registration files (`src/schema/tools.ts`, `src/tools/index.ts`, `src/tools/metadata.ts`, `src/index.ts`) → ownership not disjoint → parallel would conflict; sequential is simpler and faster here. **Dependency order:** T1→T2→T3→{T4→T5→T6}→T7→T8. **T9, T10, T11 parallelizable** after T8 (disjoint files: skills / manifests+scripts / docs) — assign T9+T11 to content-strategist, T10 to backend-developer; no cohesion contract needed (no shared files).

## Done criteria
All 11 tasks checked AND: `npm run build && npm run typecheck && npm test` green; the 7 §8 criteria each proven by a named test; `rolepod-dblab doctor` exits 0; dblab connects + `tools/list` shows 5 tools in Claude Code and Codex; runs standalone (no rolepod core) and the 4 compose seams are documented.

## Risks
- **Held-txn lingering locks** — agent abandons mid-ritual → idle auto-rollback (T7) is the backstop; default 10min, surfaced in db-write SKILL.
- **Python env absent / models not importable** — drift returns `{unverifiable,reason}` + snapshot fallback (T8); never blocks the other 4 skills (all pure-TS).
- **pg not installed** — `loadPg()` throws guided install error; `doctor` flags `fail` (not warn). pg is a strict dependency so this only bites on a broken install.
- **Schema-export reads stale dist** — `build:schemas` chained after `tsup` via `&&`; schema changes need full `npm run build`, not bare `tsup`.
- **Cursor/Gemini manifests not live-tested in v1** — accepted; schema-validated only. If a user reports breakage, promote to live-test in v1.1.
