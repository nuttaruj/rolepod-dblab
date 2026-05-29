import { ok, safeHandler } from "./result.js";
import type { ToolModule } from "./types.js";
import { ToolNames, dbExplainShape, type DbExplainInput } from "../schema/tools.js";
import { RolepodMcpError } from "../util/errors.js";
import { writeManifest } from "../util/manifest.js";

export type PlanNode = {
  "Node Type"?: string;
  "Relation Name"?: string;
  "Plan Rows"?: number;
  Filter?: string;
  Plans?: PlanNode[];
  [k: string]: unknown;
};

export type ExplainFlag = {
  kind: "seq_scan" | "possible_missing_index";
  relation: string | null;
  plan_rows: number | null;
  filter?: string;
  detail: string;
};

/**
 * Walk the plan tree and flag sequential scans. A Seq Scan that carries a
 * Filter is the canonical "this WHERE could use an index" pattern → flagged
 * `possible_missing_index`; an unfiltered Seq Scan is reported as `seq_scan`.
 * Exported for unit testing against synthetic plans.
 */
export function analyzePlan(root: PlanNode): ExplainFlag[] {
  const flags: ExplainFlag[] = [];
  const walk = (node: PlanNode): void => {
    if (node["Node Type"] === "Seq Scan") {
      const relation = node["Relation Name"] ?? null;
      const planRows = node["Plan Rows"] ?? null;
      const filter = typeof node.Filter === "string" ? node.Filter : undefined;
      if (filter) {
        flags.push({
          kind: "possible_missing_index",
          relation,
          plan_rows: planRows,
          filter,
          detail: `Seq Scan with filter on "${relation}" — consider an index on the filtered column(s).`,
        });
      } else {
        flags.push({
          kind: "seq_scan",
          relation,
          plan_rows: planRows,
          detail: `Seq Scan on "${relation}"${planRows != null ? ` (~${planRows} rows)` : ""}.`,
        });
      }
    }
    for (const child of node.Plans ?? []) walk(child);
  };
  walk(root);
  return flags;
}

/**
 * rolepod_db_explain — run EXPLAIN [ANALYZE] and return the parsed plan with
 * flags for sequential scans / probable missing indexes (perf evidence).
 * Phase: review. Read-only (writes rejected even under ANALYZE).
 */
export const dbExplainTool: ToolModule<typeof dbExplainShape> = {
  name: ToolNames.dbExplain,
  description:
    "Run EXPLAIN [ANALYZE] and return the parsed query plan, flagging sequential scans and probable missing indexes as performance evidence.",
  inputShape: dbExplainShape,
  build(ctx) {
    return safeHandler(async (args: DbExplainInput) => {
      const startedAt = new Date().toISOString();

      let planArray: unknown;
      try {
        planArray = await ctx.engine.explain(args.conn, args.sql, args.analyze);
      } catch (err) {
        if (err && typeof err === "object" && (err as { code?: string }).code === "25006") {
          throw new RolepodMcpError(
            "read_only_violation",
            "EXPLAIN ANALYZE attempted a write inside a READ ONLY transaction. db-explain is read-only — use db-write for mutations.",
          );
        }
        throw err;
      }

      const root = Array.isArray(planArray)
        ? ((planArray[0] as { Plan?: PlanNode } | undefined)?.Plan ?? null)
        : null;
      if (!root) {
        throw new RolepodMcpError("query_error", "EXPLAIN returned no plan.");
      }

      const flags = analyzePlan(root);
      const hasConcerns = flags.some((f) => f.kind === "possible_missing_index");
      const finishedAt = new Date().toISOString();

      const run = await ctx.store.startRun("db-explain");
      const reportPath = await ctx.store.writeReport(
        run.runDir,
        "plan.json",
        JSON.stringify({ sql: args.sql, analyze: args.analyze, flags, plan: planArray }, null, 2),
      );
      const manifestPath = await writeManifest({
        runDir: run.runDir,
        skill: "db-explain",
        phase: "review",
        status: hasConcerns ? "warn" : "pass",
        summary: hasConcerns
          ? `${flags.filter((f) => f.kind === "possible_missing_index").length} probable missing index(es); ${flags.length} flag(s) total`
          : flags.length > 0
            ? `${flags.length} sequential scan(s), none filtered`
            : "No sequential scans flagged",
        startedAt,
        finishedAt,
        artifacts: [{ type: "plan", path: reportPath }],
        metadata: { flag_count: flags.length, has_concerns: hasConcerns, analyze: args.analyze },
      });

      return ok({
        run_id: run.runId,
        mode: run.mode,
        has_concerns: hasConcerns,
        flags,
        plan: planArray,
        manifest_path: manifestPath,
      });
    });
  },
};
