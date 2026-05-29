// The minimal schema shape the drift differ compares. Both sides reduce to
// this: the live DB (via PgEngine.introspectSchema → normalizeLiveSchema) and
// the declared models (via the Python reflection sidecar / a snapshot file).
// Kept to name/type/nullable — the v1 drift classes (§8#5) are missing-column,
// nullability, and type mismatch.

export type DriftColumn = {
  name: string;
  type: string;
  nullable: boolean;
};

export type DriftTable = {
  name: string;
  columns: DriftColumn[];
};

export type NormalizedSchema = {
  tables: DriftTable[];
};

export type DriftClass =
  | "missing_table"
  | "extra_table"
  | "missing_column"
  | "extra_column"
  | "nullability_mismatch"
  | "type_mismatch";

export type DriftFinding = {
  class: DriftClass;
  table: string;
  column?: string;
  /** What the models declare (the source of truth). */
  expected?: string;
  /** What the live database has. */
  actual?: string;
  detail: string;
};
