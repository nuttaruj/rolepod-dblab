import { ok, safeHandler } from "./result.js";
import type { ToolContext, ToolModule } from "./types.js";
import { ToolNames, dbWriteShape, type DbWriteInput } from "../schema/tools.js";
import { RolepodMcpError } from "../util/errors.js";
import { writeManifest } from "../util/manifest.js";
import type { ManifestStatus } from "../util/manifest.js";

const SAMPLE_CAP = 5;

/**
 * rolepod_db_write — guarded mutation. The only stateful tool: it holds a
 * transaction open across calls.
 *
 *   1. mode=preview  → BEGIN (held), run the statement, capture affected rows
 *                      and an optional before/after sample, return a txn_id.
 *                      NOTHING is committed.
 *   2. mode=confirm  → COMMIT the held transaction.
 *   3. mode=rollback → ROLLBACK (also the fate of any abandoned/idle txn).
 *
 * This preview→confirm→commit/rollback ritual is the differentiator vs a
 * generic Postgres MCP that runs destructive SQL with no guard. Phase: build.
 */
export const dbWriteTool: ToolModule<typeof dbWriteShape> = {
  name: ToolNames.dbWrite,
  description:
    "Mutate data behind a transaction guard: preview a statement inside a held transaction (no commit), then confirm to COMMIT or rollback to discard. The only tool that writes.",
  inputShape: dbWriteShape,
  build(ctx) {
    return safeHandler(async (args: DbWriteInput) => {
      if (args.mode === "preview") return preview(ctx, args);
      if (args.mode === "confirm") return finalize(ctx, args, "confirm");
      return finalize(ctx, args, "rollback");
    });
  },
};

async function preview(ctx: ToolContext, args: DbWriteInput) {
  if (!args.statement) {
    throw new RolepodMcpError("invalid_input", "mode=preview needs a `statement` to run.");
  }
  const startedAt = new Date().toISOString();
  const session = await ctx.registry.open(args.conn);
  try {
    const before = args.preview_query
      ? (await session.client.query(args.preview_query)).rows.slice(0, SAMPLE_CAP)
      : [];
    const res = await session.client.query(args.statement);
    const after = args.preview_query
      ? (await session.client.query(args.preview_query)).rows.slice(0, SAMPLE_CAP)
      : [];

    session.preview = {
      statement: args.statement,
      affected_rows: res.rowCount ?? 0,
      returned: (res.rows ?? []).slice(0, SAMPLE_CAP) as Array<Record<string, unknown>>,
      before_sample: before as Array<Record<string, unknown>>,
      after_sample: after as Array<Record<string, unknown>>,
    };

    const manifestPath = await emitManifest(ctx, "warn", session.preview.statement, {
      mode: "preview",
      affected_rows: session.preview.affected_rows,
      committed: false,
    }, startedAt);

    return ok({
      txn_id: session.id,
      committed: false,
      preview: session.preview,
      next: "Call db-write again with mode='confirm' and this txn_id to COMMIT, or mode='rollback' to discard. The transaction auto-rolls-back if left idle.",
      manifest_path: manifestPath,
    });
  } catch (err) {
    // The preview statement failed — don't leave a dangling held transaction.
    await ctx.registry.rollback(session.id);
    throw err;
  }
}

async function finalize(ctx: ToolContext, args: DbWriteInput, action: "confirm" | "rollback") {
  if (!args.txn_id) {
    throw new RolepodMcpError("invalid_input", `mode=${action} needs the \`txn_id\` from a preview.`);
  }
  const startedAt = new Date().toISOString();
  const session = ctx.registry.get(args.txn_id);
  if (!session) {
    throw new RolepodMcpError(
      "txn_not_found",
      `No held transaction with id "${args.txn_id}" — it may have been committed, rolled back, or auto-expired.`,
    );
  }
  const affected = session.preview?.affected_rows ?? 0;
  const statement = session.preview?.statement ?? "";

  if (action === "confirm") {
    await ctx.registry.commit(args.txn_id);
  } else {
    await ctx.registry.rollback(args.txn_id);
  }

  const status: ManifestStatus = action === "confirm" ? "pass" : "warn";
  const manifestPath = await emitManifest(ctx, status, statement, {
    mode: action,
    affected_rows: affected,
    committed: action === "confirm",
  }, startedAt);

  return ok({
    txn_id: args.txn_id,
    committed: action === "confirm",
    affected_rows: affected,
    manifest_path: manifestPath,
  });
}

async function emitManifest(
  ctx: ToolContext,
  status: ManifestStatus,
  statement: string,
  metadata: Record<string, unknown>,
  startedAt: string,
): Promise<string | undefined> {
  const run = await ctx.store.startRun("db-write");
  const reportPath = await ctx.store.writeReport(
    run.runDir,
    "write.json",
    JSON.stringify({ statement, ...metadata }, null, 2),
  );
  return writeManifest({
    runDir: run.runDir,
    skill: "db-write",
    phase: "build",
    status,
    summary: `db-write ${String(metadata.mode)}: ${String(metadata.affected_rows)} row(s)${metadata.committed ? " committed" : ""}`,
    startedAt,
    finishedAt: new Date().toISOString(),
    artifacts: [{ type: "write", path: reportPath }],
    metadata,
  });
}
