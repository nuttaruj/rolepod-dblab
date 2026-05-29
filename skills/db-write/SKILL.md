---
name: db-write
description: Mutate data behind a transaction guard — preview a statement inside a held transaction (no commit), inspect the impact, then confirm to COMMIT or rollback to discard. The only dblab skill that writes. Use for any INSERT/UPDATE/DELETE that must be safe and reviewable.
---

# /db-write

Single-backend skill. Calls **`rolepod_db_write`** on the rolepod-dblab MCP server and surfaces the structured result. No fallback (D-001).

> Apply this mutation safely: see exactly what it does first, then commit only on explicit confirmation.

Phase: **Build**. This is the only tool that writes, and it never writes without a confirm. It is the reason dblab is an MCP plugin and not a prompt-only skill: it holds a transaction open across tool calls (a skill cannot).

## The ritual (non-negotiable)

1. **preview** → opens a transaction (BEGIN), runs the statement inside it, returns affected-row count + optional before/after sample, and a `txn_id`. **Nothing is committed.**
2. **confirm** → `COMMIT` the held transaction (needs the `txn_id`).
3. **rollback** → `ROLLBACK` and discard (also the fate of an abandoned transaction).

⚠️ A preview holds row locks on the affected rows until you confirm, rollback, or it times out. An unconfirmed transaction **auto-rolls-back** after the idle timeout (default 5 min; `ROLEPOD_DBLAB_TXN_IDLE_MS`). Confirm or rollback promptly — don't leave a preview open.

## When to use

- Any INSERT / UPDATE / DELETE you want to apply with a review step.
- A data fix in production where seeing the impact before committing matters.
- Backfills / corrections where you want a preview of affected rows.

## When NOT to use

- **Target is a WordPress site** → `rolepod-wplab` owns WP writes (it has its own change ledger + panic-revert); do not use dblab on a WP database (SPEC §3).
- Schema changes (DDL migrations) — run those through your migration tool; verify the result with `/db-migrate-verify`.
- Read-only assertions → `/db-query`.

## Inputs

- `conn` — connection string (secret; never logged).
- `mode` — `preview` | `confirm` | `rollback`.
- `statement` — the INSERT/UPDATE/DELETE. Required for `preview`; ignored otherwise.
- `txn_id` — returned by a preview; required for `confirm` / `rollback`.
- `preview_query` *(optional)* — a SELECT run before AND after the statement (inside the txn) to capture a before/after sample.

## Process

Step 1 — preview:

```json
{
  "conn": "postgresql://…/db",
  "mode": "preview",
  "statement": "UPDATE accounts SET tier = 'pro' WHERE id = 42",
  "preview_query": "SELECT tier FROM accounts WHERE id = 42"
}
```

Returns `{ txn_id, committed: false, preview: { affected_rows, before_sample, after_sample, returned } }`.

Step 2 — confirm (after the user/agent approves the impact):

```json
{ "conn": "postgresql://…/db", "mode": "confirm", "txn_id": "<from preview>" }
```

Or discard:

```json
{ "conn": "postgresql://…/db", "mode": "rollback", "txn_id": "<from preview>" }
```

## Outputs

- preview: `txn_id`, `committed: false`, `preview` (`statement`, `affected_rows`, `before_sample`, `after_sample`, `returned`), `next`.
- confirm: `committed: true`, `affected_rows`. rollback: `committed: false`.
- A vanished `txn_id` (committed, rolled back, or auto-expired) returns `txn_not_found`.
- `manifest_path` (phase `build`; status `warn` for preview/rollback, `pass` for confirm).

## Examples

### Safe single-row fix

1. preview the `UPDATE` with a `preview_query` → confirm `affected_rows: 1` and the after-sample shows the intended value.
2. confirm with the `txn_id` → committed.

## Evidence routing

- **Standalone:** `.rolepod-dblab/artifacts/db-write_<ts>_<uuid>/`
- **With `rolepod` parent** (marker `<git-root>/.rolepod/parent-active`): `<git-root>/.rolepod/evidence/<ts>-rolepod-dblab-db-write/`

Each call writes `write.json` + a `manifest.json` (Extension Protocol v1) recording the statement and outcome.

## If the tool is unavailable

> The `/db-write` skill needs the **rolepod-dblab** MCP server, which is not currently available. Confirm the plugin is installed and try again, or check that `npx -y @rolepod/dblab` is reachable.
