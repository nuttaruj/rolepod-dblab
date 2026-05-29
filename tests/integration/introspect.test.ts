import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PgEngine } from "../../src/engine/PgEngine.js";
import { ArtifactStore } from "../../src/artifact/ArtifactStore.js";
import { PgSessionRegistry } from "../../src/session/PgSessionRegistry.js";
import { dbIntrospectTool } from "../../src/tools/db_introspect.js";
import type { ToolContext } from "../../src/tools/types.js";
import { startPg, dockerAvailable, type PgHandle } from "../helpers/pgContainer.js";

const hasDocker = await dockerAvailable();

type IntrospectOut = {
  table_count: number;
  tables: Array<{ name: string; foreignKeys: Array<{ refTable: string }>; indexes: Array<{ columns: string[] }> }>;
  manifest_path: string;
};

describe.skipIf(!hasDocker)("rolepod_db_introspect (live Postgres)", () => {
  let pg: PgHandle;
  let artRoot: string;

  beforeAll(async () => {
    pg = await startPg();
    artRoot = mkdtempSync(join(tmpdir(), "dblab-art-"));
    const engine = new PgEngine();
    await engine.withConnection(pg.url, async (c) => {
      await c.query(`CREATE TABLE customer (id serial PRIMARY KEY, email varchar(255) NOT NULL)`);
      await c.query(
        `CREATE TABLE "order" (
           id serial PRIMARY KEY,
           customer_id integer NOT NULL REFERENCES customer(id),
           total numeric(10,2)
         )`,
      );
      await c.query(`CREATE INDEX order_customer_idx ON "order"(customer_id)`);
    });
  }, 60_000);

  afterAll(async () => {
    await pg?.stop();
  });

  it("returns the schema with FK + index and writes an Extension Protocol v1 manifest", async () => {
    const engine = new PgEngine();
    const ctx: ToolContext = {
      engine,
      store: new ArtifactStore({ rootDir: artRoot }),
      registry: new PgSessionRegistry(engine),
    };
    const handler = dbIntrospectTool.build(ctx);
    const res = await handler({ conn: pg.url, schema: "public", include_row_counts: true });
    expect(res.isError).toBeFalsy();

    const out = res.structuredContent as unknown as IntrospectOut;
    expect(out.table_count).toBeGreaterThanOrEqual(2);

    const order = out.tables.find((t) => t.name === "order");
    expect(order).toBeDefined();
    expect(order!.foreignKeys[0]?.refTable).toBe("customer");
    expect(order!.indexes.some((i) => i.columns.includes("customer_id"))).toBe(true);

    expect(out.manifest_path).toBeTruthy();
    expect(existsSync(out.manifest_path)).toBe(true);
    const manifest = JSON.parse(readFileSync(out.manifest_path, "utf8"));
    expect(manifest.protocol).toBe("rolepod/v1");
    expect(manifest.plugin).toBe("rolepod-dblab");
    expect(manifest.skill).toBe("db-introspect");
    expect(manifest.phase).toBe("debug");
    expect(manifest.status).toBe("pass");
  });
});
