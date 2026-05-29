import type { Client } from "pg";
import { RolepodMcpError } from "../util/errors.js";
import type {
  SchemaSnapshot,
  TableInfo,
  ColumnInfo,
  IndexInfo,
  ForeignKeyInfo,
} from "./types.js";

// Minimal surface of the `pg` module we depend on. `pg` is lazy-loaded via
// dynamic import (mirrors how uiproof lazy-loads webdriverio) so `doctor`,
// `--version`, and the MCP handshake never pay the driver cost, and a broken
// install surfaces a guided error instead of a stack trace.
type PgModule = {
  Client: new (config: { connectionString: string }) => Client;
};

export type IntrospectOptions = {
  schema?: string;
  includeRowCounts?: boolean;
};

export class PgEngine {
  private pgCache: PgModule | null = null;

  private async loadPg(): Promise<PgModule> {
    if (this.pgCache) return this.pgCache;
    try {
      const mod = (await import(/* @vite-ignore */ "pg")) as unknown as PgModule & {
        default?: PgModule;
      };
      const resolved = (mod.Client ? mod : mod.default) as PgModule;
      this.pgCache = resolved;
      return resolved;
    } catch {
      throw new RolepodMcpError(
        "engine_error",
        "PostgreSQL support needs the `pg` package. Run: npm i pg",
      );
    }
  }

  /** Open a new connection. Caller owns the lifecycle (use for held txns). */
  async connect(connectionString: string): Promise<Client> {
    const pg = await this.loadPg();
    const client = new pg.Client({ connectionString });
    try {
      await client.connect();
    } catch (err) {
      await client.end().catch(() => undefined);
      const message = err instanceof Error ? err.message : String(err);
      // The connection string is a secret — scrub it (and any URI form) from
      // the surfaced error before it reaches logs/clients.
      throw new RolepodMcpError("engine_error", `Could not connect to Postgres: ${redactConn(message, connectionString)}`);
    }
    return client;
  }

  /** Connect, run `fn`, always disconnect — for stateless reads. */
  async withConnection<T>(
    connectionString: string,
    fn: (client: Client) => Promise<T>,
  ): Promise<T> {
    const client = await this.connect(connectionString);
    try {
      return await fn(client);
    } finally {
      await client.end().catch(() => undefined);
    }
  }

  async serverVersion(connectionString: string): Promise<string> {
    return this.withConnection(connectionString, async (c) => {
      const r = await c.query<{ version: string }>("SELECT version()");
      return r.rows[0]?.version ?? "unknown";
    });
  }

  /**
   * Read the live schema into the normalized SchemaSnapshot shape. Row counts
   * use pg_class.reltuples estimates (cheap; exact COUNT is intentionally not
   * run — introspection must stay fast on large DBs).
   */
  async introspectSchema(
    connectionString: string,
    opts: IntrospectOptions = {},
  ): Promise<SchemaSnapshot> {
    const schema = opts.schema ?? "public";
    return this.withConnection(connectionString, async (c) => {
      const tableRows = await c.query<{ table_name: string }>(
        `SELECT table_name FROM information_schema.tables
         WHERE table_schema = $1 AND table_type = 'BASE TABLE'
         ORDER BY table_name`,
        [schema],
      );

      const colRows = await c.query<{
        table_name: string;
        column_name: string;
        data_type: string;
        is_nullable: string;
        column_default: string | null;
        character_maximum_length: number | null;
        numeric_precision: number | null;
        numeric_scale: number | null;
      }>(
        `SELECT table_name, column_name, data_type, is_nullable, column_default,
                character_maximum_length, numeric_precision, numeric_scale
         FROM information_schema.columns
         WHERE table_schema = $1
         ORDER BY table_name, ordinal_position`,
        [schema],
      );

      const pkRows = await c.query<{ table_name: string; column_name: string }>(
        `SELECT tc.table_name, kcu.column_name
         FROM information_schema.table_constraints tc
         JOIN information_schema.key_column_usage kcu
           ON tc.constraint_name = kcu.constraint_name
          AND tc.table_schema = kcu.table_schema
         WHERE tc.table_schema = $1 AND tc.constraint_type = 'PRIMARY KEY'`,
        [schema],
      );

      const fkRows = await c.query<{
        constraint_name: string;
        table_name: string;
        column_name: string;
        ref_table: string;
        ref_column: string;
      }>(
        `SELECT tc.constraint_name, tc.table_name, kcu.column_name,
                ccu.table_name AS ref_table, ccu.column_name AS ref_column
         FROM information_schema.table_constraints tc
         JOIN information_schema.key_column_usage kcu
           ON tc.constraint_name = kcu.constraint_name
          AND tc.table_schema = kcu.table_schema
         JOIN information_schema.constraint_column_usage ccu
           ON ccu.constraint_name = tc.constraint_name
          AND ccu.table_schema = tc.table_schema
         WHERE tc.table_schema = $1 AND tc.constraint_type = 'FOREIGN KEY'
         ORDER BY tc.constraint_name`,
        [schema],
      );

      const idxRows = await c.query<{
        table_name: string;
        index_name: string;
        is_unique: boolean;
        column_name: string;
        ord: number | null;
      }>(
        `SELECT t.relname AS table_name, i.relname AS index_name,
                ix.indisunique AS is_unique, a.attname AS column_name,
                array_position(ix.indkey, a.attnum) AS ord
         FROM pg_class t
         JOIN pg_namespace n ON n.oid = t.relnamespace
         JOIN pg_index ix ON ix.indrelid = t.oid
         JOIN pg_class i ON i.oid = ix.indexrelid
         JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY(ix.indkey)
         WHERE n.nspname = $1 AND t.relkind = 'r'
         ORDER BY i.relname, ord`,
        [schema],
      );

      const rowCounts = opts.includeRowCounts
        ? await c.query<{ table_name: string; est_rows: string }>(
            `SELECT c.relname AS table_name, c.reltuples::bigint AS est_rows
             FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
             WHERE n.nspname = $1 AND c.relkind = 'r'`,
            [schema],
          )
        : null;

      // Assemble per-table.
      const pkSet = new Set(pkRows.rows.map((r) => `${r.table_name}.${r.column_name}`));
      const rowCountByTable = new Map<string, number>();
      for (const r of rowCounts?.rows ?? []) {
        rowCountByTable.set(r.table_name, Number(r.est_rows));
      }

      const colsByTable = new Map<string, ColumnInfo[]>();
      for (const r of colRows.rows) {
        const list = colsByTable.get(r.table_name) ?? [];
        list.push({
          name: r.column_name,
          type: normalizeType(r),
          nullable: r.is_nullable === "YES",
          default: r.column_default,
          primaryKey: pkSet.has(`${r.table_name}.${r.column_name}`),
        });
        colsByTable.set(r.table_name, list);
      }

      const fksByTable = new Map<string, Map<string, ForeignKeyInfo>>();
      for (const r of fkRows.rows) {
        const perTable = fksByTable.get(r.table_name) ?? new Map();
        const fk = perTable.get(r.constraint_name) ?? {
          name: r.constraint_name,
          columns: [],
          refTable: r.ref_table,
          refColumns: [],
        };
        fk.columns.push(r.column_name);
        fk.refColumns.push(r.ref_column);
        perTable.set(r.constraint_name, fk);
        fksByTable.set(r.table_name, perTable);
      }

      const idxByTable = new Map<string, Map<string, IndexInfo>>();
      for (const r of idxRows.rows) {
        const perTable = idxByTable.get(r.table_name) ?? new Map();
        const idx = perTable.get(r.index_name) ?? {
          name: r.index_name,
          columns: [],
          unique: r.is_unique,
        };
        idx.columns.push(r.column_name);
        perTable.set(r.index_name, idx);
        idxByTable.set(r.table_name, perTable);
      }

      const tables: TableInfo[] = tableRows.rows.map((t) => ({
        name: t.table_name,
        columns: colsByTable.get(t.table_name) ?? [],
        indexes: [...(idxByTable.get(t.table_name)?.values() ?? [])],
        foreignKeys: [...(fksByTable.get(t.table_name)?.values() ?? [])],
        rowCount: rowCountByTable.has(t.table_name)
          ? (rowCountByTable.get(t.table_name) ?? null)
          : null,
      }));

      return { dialect: "postgres", schema, tables };
    });
  }

  /**
   * Run a query inside `BEGIN TRANSACTION READ ONLY` and ROLLBACK. Postgres
   * rejects any data-modifying statement at the engine level (writable CTEs,
   * side-effecting functions, INSERT/UPDATE/DELETE) — far more robust than
   * string-parsing for SELECT. A write raises SQLSTATE 25006, which the caller
   * maps to a `read_only_violation`.
   */
  async runReadOnly(
    connectionString: string,
    sql: string,
    timeoutMs?: number,
  ): Promise<{ rows: Array<Record<string, unknown>>; fields: string[] }> {
    return this.withConnection(connectionString, async (c) => {
      await c.query("BEGIN TRANSACTION READ ONLY");
      try {
        if (timeoutMs && timeoutMs > 0) {
          await c.query(`SET LOCAL statement_timeout = ${Math.floor(timeoutMs)}`);
        }
        const r = await c.query(sql);
        return {
          rows: r.rows as Array<Record<string, unknown>>,
          fields: (r.fields ?? []).map((f) => f.name),
        };
      } finally {
        await c.query("ROLLBACK").catch(() => undefined);
      }
    });
  }

  /**
   * Run EXPLAIN [ANALYZE] and return the parsed JSON plan array. Wrapped in a
   * READ ONLY transaction so EXPLAIN ANALYZE — which actually executes the
   * statement — can never mutate: a write raises SQLSTATE 25006 and the txn is
   * rolled back regardless.
   */
  async explain(connectionString: string, sql: string, analyze = false): Promise<unknown> {
    return this.withConnection(connectionString, async (c) => {
      await c.query("BEGIN TRANSACTION READ ONLY");
      try {
        const prefix = analyze ? "EXPLAIN (FORMAT JSON, ANALYZE)" : "EXPLAIN (FORMAT JSON)";
        const r = await c.query(`${prefix} ${sql}`);
        const row = r.rows[0] as Record<string, unknown> | undefined;
        return row?.["QUERY PLAN"];
      } finally {
        await c.query("ROLLBACK").catch(() => undefined);
      }
    });
  }
}

/** Strip a raw connection string (and any postgres URI) from an error message. */
function redactConn(message: string, conn: string): string {
  const scrubbed = conn ? message.split(conn).join("<connection-string>") : message;
  return scrubbed.replace(/postgres(?:ql)?:\/\/\S+/gi, "<connection-string>");
}

function normalizeType(r: {
  data_type: string;
  character_maximum_length: number | null;
  numeric_precision: number | null;
  numeric_scale: number | null;
}): string {
  if (r.character_maximum_length != null) {
    return `${r.data_type}(${r.character_maximum_length})`;
  }
  if (r.data_type === "numeric" && r.numeric_precision != null) {
    return r.numeric_scale != null
      ? `numeric(${r.numeric_precision},${r.numeric_scale})`
      : `numeric(${r.numeric_precision})`;
  }
  return r.data_type;
}
