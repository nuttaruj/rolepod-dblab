import { ok, safeHandler } from "./result.js";
import type { ToolModule } from "./types.js";
import { ToolNames, dbQueryShape, type DbQueryInput } from "../schema/tools.js";
import { RolepodMcpError } from "../util/errors.js";
import { writeManifest } from "../util/manifest.js";

type Check = { name: string; expected: unknown; actual: unknown; passed: boolean };

/** pg returns bigint/numeric as strings; compare loosely so `value: 1` matches "1". */
function looseEq(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a == null || b == null) return a == b;
  return String(a) === String(b);
}

/**
 * rolepod_db_query — run a read-only query and return a structured PASS/FAIL
 * assertion (NOT raw rows). The query runs inside a READ ONLY transaction; a
 * write attempt is rejected as `read_only_violation`. Phase: verify.
 */
export const dbQueryTool: ToolModule<typeof dbQueryShape> = {
  name: ToolNames.dbQuery,
  description:
    "Assert database state as verify-evidence: run a read-only query and check it against expected exists/row_count/value. Returns PASS/FAIL, not raw rows.",
  inputShape: dbQueryShape,
  build(ctx) {
    return safeHandler(async (args: DbQueryInput) => {
      const startedAt = new Date().toISOString();

      let result: { rows: Array<Record<string, unknown>>; fields: string[] };
      try {
        result = await ctx.engine.runReadOnly(args.conn, args.sql, args.timeout_ms);
      } catch (err) {
        if (err && typeof err === "object" && (err as { code?: string }).code === "25006") {
          throw new RolepodMcpError(
            "read_only_violation",
            "Statement attempted a write inside a READ ONLY transaction. db-query is read-only — use db-write for mutations.",
          );
        }
        throw err;
      }

      const rows = result.rows;
      const checks: Check[] = [];
      const { exists, row_count, value } = args.expect;
      if (exists !== undefined) {
        const actual = rows.length > 0;
        checks.push({ name: "exists", expected: exists, actual, passed: actual === exists });
      }
      if (row_count !== undefined) {
        const actual = rows.length;
        checks.push({ name: "row_count", expected: row_count, actual, passed: actual === row_count });
      }
      if (value !== undefined) {
        const first = rows[0];
        const actual = first ? (Object.values(first)[0] ?? null) : null;
        checks.push({ name: "value", expected: value, actual, passed: looseEq(actual, value) });
      }
      if (checks.length === 0) {
        throw new RolepodMcpError(
          "invalid_input",
          "db-query needs at least one assertion in `expect` (exists / row_count / value).",
        );
      }

      const passed = checks.every((c) => c.passed);
      const sample = rows.slice(0, 5);
      const finishedAt = new Date().toISOString();

      const run = await ctx.store.startRun("db-query");
      const reportPath = await ctx.store.writeReport(
        run.runDir,
        "assertion.json",
        JSON.stringify({ sql: args.sql, passed, checks, row_count: rows.length, sample }, null, 2),
      );
      const manifestPath = await writeManifest({
        runDir: run.runDir,
        skill: "db-query",
        phase: "verify",
        status: passed ? "pass" : "fail",
        summary: passed
          ? `All ${checks.length} assertion(s) passed`
          : `${checks.filter((c) => !c.passed).length} of ${checks.length} assertion(s) failed`,
        startedAt,
        finishedAt,
        artifacts: [{ type: "assertion", path: reportPath }],
        metadata: { passed, check_count: checks.length, row_count: rows.length },
      });

      return ok({
        run_id: run.runId,
        mode: run.mode,
        passed,
        checks,
        row_count: rows.length,
        sample,
        manifest_path: manifestPath,
      });
    });
  },
};
