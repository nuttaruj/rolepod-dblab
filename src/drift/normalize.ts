import type { SchemaSnapshot } from "../engine/types.js";
import type { NormalizedSchema } from "./types.js";

/**
 * Reduce a live SchemaSnapshot (from PgEngine.introspectSchema) to the drift
 * comparison shape. Reuses the introspection already performed by the tool —
 * it does NOT re-query the database (DRY).
 */
export function normalizeLiveSchema(snap: SchemaSnapshot): NormalizedSchema {
  return {
    tables: snap.tables.map((t) => ({
      name: t.name,
      columns: t.columns.map((c) => ({ name: c.name, type: c.type, nullable: c.nullable })),
    })),
  };
}
