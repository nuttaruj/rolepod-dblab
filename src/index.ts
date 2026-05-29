// Public library surface — re-export pieces consumers might want to embed
// programmatically (e.g. running the server in-process for tests).
//
// Grows across the build: T4+ add the rolepod_db_* ToolNames and per-tool Zod
// schemas (consumed by scripts/export-schemas.mjs).
export { SERVER_NAME, SERVER_VERSION } from "./version.js";
export { buildServer } from "./server.js";
export type { ServerHandle } from "./server.js";
export { PgEngine } from "./engine/PgEngine.js";
export type { IntrospectOptions } from "./engine/PgEngine.js";
export type {
  SchemaSnapshot,
  TableInfo,
  ColumnInfo,
  IndexInfo,
  ForeignKeyInfo,
} from "./engine/types.js";
export { ArtifactStore } from "./artifact/ArtifactStore.js";
export {
  ToolNames,
  type ToolName,
  // raw shapes (for MCP SDK registerTool consumers) + derived schemas (json-schema export)
  dbIntrospectShape,
  dbIntrospectSchema,
  dbQueryShape,
  dbQuerySchema,
  dbExplainShape,
  dbExplainSchema,
  dbWriteShape,
  dbWriteSchema,
  dbMigrateVerifyShape,
  dbMigrateVerifySchema,
} from "./schema/tools.js";
export { PgSessionRegistry } from "./session/PgSessionRegistry.js";
export type { PgSession } from "./session/PgSession.js";
export { diffSchemas, canonicalType } from "./drift/differ.js";
export { normalizeLiveSchema } from "./drift/normalize.js";
export { reflectModels } from "./drift/sidecar.js";
export type {
  NormalizedSchema,
  DriftFinding,
  DriftClass,
  DriftTable,
  DriftColumn,
} from "./drift/types.js";
export { RolepodMcpError } from "./util/errors.js";
export type { ErrorCode } from "./util/errors.js";
