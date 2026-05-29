import { ok, safeHandler } from "./result.js";
import type { ToolModule } from "./types.js";
import { ToolNames, dbMigrateVerifyShape, type DbMigrateVerifyInput } from "../schema/tools.js";
import { normalizeLiveSchema } from "../drift/normalize.js";
import { diffSchemas } from "../drift/differ.js";
import { reflectModels, type ReflectOptions } from "../drift/sidecar.js";
import { writeManifest } from "../util/manifest.js";

/**
 * rolepod_db_migrate_verify — detect schema drift between declared SQLAlchemy
 * models (reflected via the Python sidecar) and the live database. The live
 * side reuses introspection; the TS side owns the diff. If the models can't be
 * reflected (and no snapshot is given) it returns `unverifiable` with a reason
 * — it never blocks, and never reports a false PASS. Phase: review.
 */
export const dbMigrateVerifyTool: ToolModule<typeof dbMigrateVerifyShape> = {
  name: ToolNames.dbMigrateVerify,
  description:
    "Detect schema drift between SQLAlchemy models and the live database (missing/extra columns, nullability, type mismatch). Read-only.",
  inputShape: dbMigrateVerifyShape,
  build(ctx) {
    return safeHandler(async (args: DbMigrateVerifyInput) => {
      const startedAt = new Date().toISOString();

      // Live side — reuse introspection (no extra query beyond this one read).
      const snap = await ctx.engine.introspectSchema(args.conn, { schema: args.schema });
      const live = normalizeLiveSchema(snap);

      // Declared side — Python sidecar (native) or snapshot fallback.
      const reflectOpts: ReflectOptions = {};
      if (args.models_entrypoint !== undefined) reflectOpts.modelsEntrypoint = args.models_entrypoint;
      if (args.snapshot_path !== undefined) reflectOpts.snapshotPath = args.snapshot_path;
      if (args.project_dir !== undefined) reflectOpts.cwd = args.project_dir;
      const reflected = await reflectModels(reflectOpts);

      const run = await ctx.store.startRun("db-migrate-verify");

      if (!reflected.ok) {
        const reportPath = await ctx.store.writeReport(
          run.runDir,
          "drift.json",
          JSON.stringify({ unverifiable: true, reason: reflected.reason }, null, 2),
        );
        const manifestPath = await writeManifest({
          runDir: run.runDir,
          skill: "db-migrate-verify",
          phase: "review",
          status: "warn",
          summary: `Drift unverifiable: ${reflected.reason}`,
          startedAt,
          finishedAt: new Date().toISOString(),
          artifacts: [{ type: "drift", path: reportPath }],
          metadata: { unverifiable: true },
        });
        return ok({
          run_id: run.runId,
          mode: run.mode,
          unverifiable: true,
          reason: reflected.reason,
          manifest_path: manifestPath,
        });
      }

      const drift = diffSchemas(reflected.schema, live);
      const passed = drift.length === 0;
      const reportPath = await ctx.store.writeReport(
        run.runDir,
        "drift.json",
        JSON.stringify({ passed, source: reflected.source, drift }, null, 2),
      );
      const manifestPath = await writeManifest({
        runDir: run.runDir,
        skill: "db-migrate-verify",
        phase: "review",
        status: passed ? "pass" : "fail",
        summary: passed
          ? "No schema drift between models and database"
          : `${drift.length} drift finding(s): ${[...new Set(drift.map((d) => d.class))].join(", ")}`,
        startedAt,
        finishedAt: new Date().toISOString(),
        artifacts: [{ type: "drift", path: reportPath }],
        metadata: { passed, drift_count: drift.length, source: reflected.source },
      });

      return ok({
        run_id: run.runId,
        mode: run.mode,
        unverifiable: false,
        passed,
        drift,
        manifest_path: manifestPath,
      });
    });
  },
};
