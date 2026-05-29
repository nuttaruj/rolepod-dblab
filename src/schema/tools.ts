import { z } from "zod";

/**
 * Canonical tool names (the `rolepod_db_*` wire strings) and per-tool Zod
 * shapes. The MCP SDK's `registerTool` consumes the raw shape (the plain
 * object), while the derived `z.object(...)` schemas back JSON-schema export
 * and arg parsing. All five names are declared up front; each tool task
 * (T4–T8) appends its shape below.
 */
export const ToolNames = {
  dbIntrospect: "rolepod_db_introspect",
  dbQuery: "rolepod_db_query",
  dbExplain: "rolepod_db_explain",
  dbMigrateVerify: "rolepod_db_migrate_verify",
  dbWrite: "rolepod_db_write",
} as const;
export type ToolName = (typeof ToolNames)[keyof typeof ToolNames];

/** Shared connection-string arg. Treated as a secret — never logged/echoed. */
const connArg = z
  .string()
  .min(1)
  .describe("PostgreSQL connection string (postgresql://…). Treated as a secret — never logged.");

// ---------- db-introspect (T4) ----------
export const dbIntrospectShape = {
  conn: connArg,
  schema: z.string().default("public").describe("Schema to introspect."),
  include_row_counts: z
    .boolean()
    .default(false)
    .describe("Include estimated row counts (pg_class.reltuples)."),
} as const;
export const dbIntrospectSchema = z.object(dbIntrospectShape);
export type DbIntrospectInput = z.infer<typeof dbIntrospectSchema>;

// ---------- db-query (T5) ----------
export const dbQueryShape = {
  conn: connArg,
  sql: z
    .string()
    .min(1)
    .describe(
      "A read-only query. Runs inside BEGIN TRANSACTION READ ONLY — Postgres rejects any write (incl. writable CTEs). Use db-write to mutate.",
    ),
  expect: z
    .object({
      exists: z.boolean().optional().describe("true → at least one row; false → zero rows."),
      row_count: z.number().int().nonnegative().optional().describe("Exact number of rows."),
      value: z
        .union([z.string(), z.number(), z.boolean(), z.null()])
        .optional()
        .describe("First column of the first row equals this scalar."),
    })
    .describe("Assertion(s) to evaluate. At least one of exists/row_count/value is required."),
  timeout_ms: z.number().int().positive().default(30000).describe("statement_timeout for the query."),
} as const;
export const dbQuerySchema = z.object(dbQueryShape);
export type DbQueryInput = z.infer<typeof dbQuerySchema>;

// ---------- db-explain (T6) ----------
export const dbExplainShape = {
  conn: connArg,
  sql: z.string().min(1).describe("Query to analyze. Runs under EXPLAIN inside a READ ONLY transaction."),
  analyze: z
    .boolean()
    .default(false)
    .describe("Use EXPLAIN ANALYZE (executes the query; still read-only — writes are rejected)."),
} as const;
export const dbExplainSchema = z.object(dbExplainShape);
export type DbExplainInput = z.infer<typeof dbExplainSchema>;

// ---------- db-write (T7) ----------
export const dbWriteShape = {
  conn: connArg,
  mode: z
    .enum(["preview", "confirm", "rollback"])
    .describe(
      "preview: run the statement in a held transaction and return its impact (no commit). confirm: COMMIT the held transaction. rollback: discard it.",
    ),
  statement: z
    .string()
    .optional()
    .describe("The INSERT/UPDATE/DELETE to run. Required for mode=preview; ignored otherwise."),
  txn_id: z
    .string()
    .optional()
    .describe("The transaction id returned by a preview. Required for mode=confirm/rollback."),
  preview_query: z
    .string()
    .optional()
    .describe(
      "Optional SELECT run before AND after the statement (inside the txn) to capture a before/after sample.",
    ),
} as const;
export const dbWriteSchema = z.object(dbWriteShape);
export type DbWriteInput = z.infer<typeof dbWriteSchema>;

// ---------- db-migrate-verify (T8) ----------
export const dbMigrateVerifyShape = {
  conn: connArg,
  schema: z.string().default("public").describe("Schema to compare against the models."),
  models_entrypoint: z
    .string()
    .optional()
    .describe(
      "SQLAlchemy models as 'module:attr' (a declarative Base or MetaData). Reflected via the Python sidecar in the project interpreter.",
    ),
  snapshot_path: z
    .string()
    .optional()
    .describe(
      "Fallback: path to a pre-generated normalized schema JSON, when models can't be imported here.",
    ),
  project_dir: z
    .string()
    .optional()
    .describe(
      "Directory the sidecar runs in so `models_entrypoint` imports (defaults to the server's working directory).",
    ),
} as const;
export const dbMigrateVerifySchema = z.object(dbMigrateVerifyShape);
export type DbMigrateVerifyInput = z.infer<typeof dbMigrateVerifySchema>;
