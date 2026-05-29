import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import { ToolNames } from "../schema/tools.js";

/**
 * Per-tool display metadata exposed via MCP `registerTool`.
 *
 * - `title`: human-readable label shown in client UIs (Claude Code, Cursor, …)
 * - `annotations`: trust-and-safety hints (advisory). Read-only tools set
 *   `readOnlyHint: true`; `destructiveHint`/`idempotentHint` are only
 *   meaningful when `readOnlyHint` is false, so they are omitted otherwise.
 *
 * Keyed by tool name (the `rolepod_db_*` string). Entries are added as each
 * tool lands (T4–T8).
 */
export type ToolMetadata = {
  title: string;
  annotations: ToolAnnotations;
};

export const toolMetadata: Record<string, ToolMetadata> = {
  [ToolNames.dbIntrospect]: {
    title: "Introspect Database Schema",
    annotations: { title: "Introspect Database Schema", readOnlyHint: true, openWorldHint: true },
  },
  [ToolNames.dbQuery]: {
    title: "Assert Database State",
    annotations: { title: "Assert Database State", readOnlyHint: true, openWorldHint: true },
  },
  [ToolNames.dbExplain]: {
    title: "Explain Query Plan",
    annotations: { title: "Explain Query Plan", readOnlyHint: true, openWorldHint: true },
  },
  [ToolNames.dbWrite]: {
    title: "Guarded Write (preview → confirm)",
    annotations: {
      title: "Guarded Write (preview → confirm)",
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: true,
    },
  },
  [ToolNames.dbMigrateVerify]: {
    title: "Verify Schema Drift",
    annotations: { title: "Verify Schema Drift", readOnlyHint: true, openWorldHint: true },
  },
};
