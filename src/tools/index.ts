import type { ToolModule } from "./types.js";
import { dbIntrospectTool } from "./db_introspect.js";
import { dbQueryTool } from "./db_query.js";
import { dbExplainTool } from "./db_explain.js";
import { dbWriteTool } from "./db_write.js";
import { dbMigrateVerifyTool } from "./db_migrate_verify.js";

// The registered tool set. Each tool task (T4–T8) adds its import and an
// entry here; `buildServer` iterates this array. Kept in one file so the
// sequential build appends in a single place.
//
// Typed `ToolModule<any>` on purpose: the registry is heterogeneous over the
// per-tool input shape, so the generic is erased here. Each handler is
// re-narrowed at `mcp.registerTool` via the cast in server.ts.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const tools: ReadonlyArray<ToolModule<any>> = [
  dbIntrospectTool,
  dbQueryTool,
  dbExplainTool,
  dbWriteTool,
  dbMigrateVerifyTool,
];
