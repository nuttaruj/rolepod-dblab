import { ok, safeHandler } from "./result.js";
import type { ToolModule } from "./types.js";
import { ToolNames, dbIntrospectShape, type DbIntrospectInput } from "../schema/tools.js";
import { writeManifest } from "../util/manifest.js";

/**
 * rolepod_db_introspect — read the live schema (tables, columns, types, PKs,
 * indexes, FK graph, optional row-count estimates) into the normalized
 * snapshot, write it as evidence, and emit a manifest (phase: debug).
 * Read-only.
 */
export const dbIntrospectTool: ToolModule<typeof dbIntrospectShape> = {
  name: ToolNames.dbIntrospect,
  description:
    "Introspect a live Postgres schema: tables, columns, types, primary keys, indexes, and the foreign-key graph. Read-only.",
  inputShape: dbIntrospectShape,
  build(ctx) {
    return safeHandler(async (args: DbIntrospectInput) => {
      const startedAt = new Date().toISOString();
      const snap = await ctx.engine.introspectSchema(args.conn, {
        schema: args.schema,
        includeRowCounts: args.include_row_counts,
      });
      const run = await ctx.store.startRun("db-introspect");
      const reportPath = await ctx.store.writeReport(
        run.runDir,
        "schema.json",
        JSON.stringify(snap, null, 2),
      );
      const finishedAt = new Date().toISOString();
      const manifestPath = await writeManifest({
        runDir: run.runDir,
        skill: "db-introspect",
        phase: "debug",
        status: "pass",
        summary: `Introspected ${snap.tables.length} table(s) in schema "${snap.schema}"`,
        startedAt,
        finishedAt,
        artifacts: [{ type: "schema", path: reportPath }],
        metadata: { schema: snap.schema, table_count: snap.tables.length },
      });
      return ok({
        run_id: run.runId,
        mode: run.mode,
        schema: snap.schema,
        table_count: snap.tables.length,
        tables: snap.tables,
        manifest_path: manifestPath,
      });
    });
  },
};
