import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PgEngine } from "../../src/engine/PgEngine.js";
import { ArtifactStore } from "../../src/artifact/ArtifactStore.js";
import { PgSessionRegistry } from "../../src/session/PgSessionRegistry.js";
import { dbExplainTool } from "../../src/tools/db_explain.js";
import type { ToolContext } from "../../src/tools/types.js";
import { startPg, dockerAvailable, type PgHandle } from "../helpers/pgContainer.js";

const hasDocker = await dockerAvailable();

type ExplainOut = {
  has_concerns: boolean;
  flags: Array<{ kind: string; relation: string | null }>;
  plan: unknown;
  manifest_path: string;
};

describe.skipIf(!hasDocker)("rolepod_db_explain (live Postgres)", () => {
  let pg: PgHandle;
  let ctx: ToolContext;

  beforeAll(async () => {
    pg = await startPg();
    const artRoot = mkdtempSync(join(tmpdir(), "dblab-e-"));
    const engine = new PgEngine();
    await engine.withConnection(pg.url, async (c) => {
      await c.query(`CREATE TABLE events (id serial PRIMARY KEY, kind text NOT NULL, payload text)`);
      await c.query(
        `INSERT INTO events (kind, payload)
         SELECT (ARRAY['a','b','c','d'])[1 + (i % 4)], md5(i::text)
         FROM generate_series(1, 5000) AS s(i)`,
      );
      await c.query(`ANALYZE events`);
    });
    ctx = { engine, store: new ArtifactStore({ rootDir: artRoot }), registry: new PgSessionRegistry(engine) };
  }, 60_000);

  afterAll(async () => {
    await pg?.stop();
  });

  it("parses a real plan and flags a filtered sequential scan", async () => {
    const handler = dbExplainTool.build(ctx);
    const res = await handler({
      conn: pg.url,
      sql: "SELECT * FROM events WHERE kind = 'a'",
      analyze: false,
    });
    expect(res.isError).toBeFalsy();
    const out = res.structuredContent as unknown as ExplainOut;
    expect(out.plan).toBeDefined();
    // No index on `kind` → planner uses a filtered Seq Scan → flagged.
    expect(out.flags.some((f) => f.relation === "events")).toBe(true);
    expect(out.has_concerns).toBe(true);

    const manifest = JSON.parse(readFileSync(out.manifest_path, "utf8"));
    expect(manifest.phase).toBe("review");
    expect(manifest.artifacts.length).toBeGreaterThan(0);
  });

  it("runs EXPLAIN ANALYZE without mutating (read-only)", async () => {
    const handler = dbExplainTool.build(ctx);
    const res = await handler({
      conn: pg.url,
      sql: "SELECT count(*) FROM events",
      analyze: true,
    });
    expect(res.isError).toBeFalsy();
    const out = res.structuredContent as unknown as ExplainOut;
    expect(out.plan).toBeDefined();
  });
});
