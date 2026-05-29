import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PgEngine } from "../../src/engine/PgEngine.js";
import { ArtifactStore } from "../../src/artifact/ArtifactStore.js";
import { PgSessionRegistry } from "../../src/session/PgSessionRegistry.js";
import { dbQueryTool } from "../../src/tools/db_query.js";
import type { ToolContext } from "../../src/tools/types.js";
import { startPg, dockerAvailable, type PgHandle } from "../helpers/pgContainer.js";

const hasDocker = await dockerAvailable();

type QueryOut = {
  passed: boolean;
  checks: Array<{ name: string; passed: boolean; expected: unknown; actual: unknown }>;
  row_count: number;
  manifest_path: string;
};

describe.skipIf(!hasDocker)("rolepod_db_query (live Postgres)", () => {
  let pg: PgHandle;
  let ctx: ToolContext;

  beforeAll(async () => {
    pg = await startPg();
    const artRoot = mkdtempSync(join(tmpdir(), "dblab-q-"));
    const engine = new PgEngine();
    await engine.withConnection(pg.url, async (c) => {
      await c.query(`CREATE TABLE customer (id serial PRIMARY KEY, email text NOT NULL)`);
      await c.query(`INSERT INTO customer (email) VALUES ('a@example.com')`);
    });
    ctx = { engine, store: new ArtifactStore({ rootDir: artRoot }), registry: new PgSessionRegistry(engine) };
  }, 60_000);

  afterAll(async () => {
    await pg?.stop();
  });

  it("PASSes when the row matches the expectation", async () => {
    const handler = dbQueryTool.build(ctx);
    const res = await handler({
      conn: pg.url,
      sql: "SELECT email FROM customer WHERE id = 1",
      expect: { exists: true, row_count: 1, value: "a@example.com" },
      timeout_ms: 30000,
    });
    const out = res.structuredContent as unknown as QueryOut;
    expect(out.passed).toBe(true);
    expect(out.checks).toHaveLength(3);
    const manifest = JSON.parse(readFileSync(out.manifest_path, "utf8"));
    expect(manifest.phase).toBe("verify");
    expect(manifest.status).toBe("pass");
  });

  it("FAILs (status fail, not error) when the expectation is wrong", async () => {
    const handler = dbQueryTool.build(ctx);
    const res = await handler({
      conn: pg.url,
      sql: "SELECT email FROM customer",
      expect: { row_count: 5 },
      timeout_ms: 30000,
    });
    expect(res.isError).toBeFalsy();
    const out = res.structuredContent as unknown as QueryOut;
    expect(out.passed).toBe(false);
    const manifest = JSON.parse(readFileSync(out.manifest_path, "utf8"));
    expect(manifest.status).toBe("fail");
  });

  it("rejects a writable CTE as read_only_violation (no silent write)", async () => {
    const handler = dbQueryTool.build(ctx);
    const res = await handler({
      conn: pg.url,
      sql: "WITH ins AS (INSERT INTO customer(email) VALUES ('hacker@x') RETURNING id) SELECT * FROM ins",
      expect: { exists: true },
      timeout_ms: 30000,
    });
    expect(res.isError).toBe(true);
    const payload = res.structuredContent as unknown as { code: string };
    expect(payload.code).toBe("read_only_violation");

    // prove the write did NOT happen
    const count = await ctx.engine.runReadOnly(pg.url, "SELECT count(*)::int AS n FROM customer");
    expect(count.rows[0]?.n).toBe(1);
  });
});
