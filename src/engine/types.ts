// Normalized schema descriptor — the common shape produced by BOTH live
// introspection (PgEngine.introspectSchema, T4) and the SQLAlchemy reflection
// sidecar (T8). The drift differ (T8) compares two of these. Keeping one shape
// means the diff is pure data with no engine/ORM specifics leaking in.

export type ColumnInfo = {
  name: string;
  /** Normalized type string, e.g. "integer", "character varying(255)". */
  type: string;
  nullable: boolean;
  default: string | null;
  primaryKey: boolean;
};

export type IndexInfo = {
  name: string;
  columns: string[];
  unique: boolean;
};

export type ForeignKeyInfo = {
  name: string;
  columns: string[];
  refTable: string;
  refColumns: string[];
};

export type TableInfo = {
  name: string;
  columns: ColumnInfo[];
  indexes: IndexInfo[];
  foreignKeys: ForeignKeyInfo[];
  /** Estimated row count (pg_class.reltuples); null when not collected. */
  rowCount: number | null;
};

export type SchemaSnapshot = {
  dialect: "postgres";
  schema: string;
  tables: TableInfo[];
};
