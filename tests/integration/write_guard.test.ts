import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PgEngine } from "../../src/engine/PgEngine.js";
import { ArtifactStore } from "../../src/artifact/ArtifactStore.js";
import { PgSessionRegistry } from "../../src/session/PgSessionRegistry.js";
import { dbWriteTool } from "../../src/tools/db_write.js";
import type { ToolContext } from "../../src/tools/types.js";
import { startPg, dockerAvailable, type PgHandle } from "../helpers/pgContainer.js";

const hasDocker = await dockerAvailable();

/* eslint-disable @typescript-eslint/no-explicit-any */
describe.skipIf(!hasDocker)("rolepod_db_write held-txn guard (live Postgres)", () => {
  let pg: PgHandle;
  let engine: PgEngine;
  let registry: PgSessionRegistry;
  let ctx: ToolContext;

  beforeAll(async () => {
    pg = await startPg();
    engine = new PgEngine();
    await engine.withConnection(pg.url, async (c) => {
      await c.query(`CREATE TABLE acct (id int PRIMARY KEY, balance int NOT NULL)`);
      await c.query(`INSERT INTO acct (id, balance) VALUES (1, 100)`);
    });
    const store = new ArtifactStore({ rootDir: mkdtempSync(join(tmpdir(), "dblab-w-")) });
    registry = new PgSessionRegistry(engine);
    ctx = { engine, store, registry };
  }, 60_000);

  afterAll(async () => {
    await registry?.shutdown();
    await pg?.stop();
  });

  async function balance(): Promise<number> {
    const r = await engine.runReadOnly(pg.url, "SELECT balance FROM acct WHERE id = 1");
    return Number((r.rows[0] as { balance: number }).balance);
  }
  async function resetBalance(v: number): Promise<void> {
    await engine.withConnection(pg.url, (c) =>
      c.query(`UPDATE acct SET balance = $1 WHERE id = 1`, [v]),
    );
  }

  it("preview does NOT commit — a separate connection still sees the old value", async () => {
    await resetBalance(100);
    const handler = dbWriteTool.build(ctx);
    const res = await handler({
      conn: pg.url,
      mode: "preview",
      statement: "UPDATE acct SET balance = 200 WHERE id = 1",
      preview_query: "SELECT balance FROM acct WHERE id = 1",
    });
    const out = res.structuredContent as any;
    expect(out.committed).toBe(false);
    expect(out.txn_id).toBeTruthy();
    expect(out.preview.affected_rows).toBe(1);
    expect(Number(out.preview.before_sample[0].balance)).toBe(100);
    expect(Number(out.preview.after_sample[0].balance)).toBe(200);
    expect(await balance()).toBe(100); // uncommitted — invisible to other connections
    await registry.rollback(out.txn_id);
  });

  it("confirm COMMITs the previewed change", async () => {
    await resetBalance(100);
    const handler = dbWriteTool.build(ctx);
    const p = await handler({
      conn: pg.url,
      mode: "preview",
      statement: "UPDATE acct SET balance = 250 WHERE id = 1",
    });
    const txnId = (p.structuredContent as any).txn_id;
    expect(await balance()).toBe(100);
    const c = await handler({ conn: pg.url, mode: "confirm", txn_id: txnId });
    expect((c.structuredContent as any).committed).toBe(true);
    expect(await balance()).toBe(250);
  });

  it("rollback discards the previewed change (the refused mutation)", async () => {
    await resetBalance(100);
    const handler = dbWriteTool.build(ctx);
    const p = await handler({
      conn: pg.url,
      mode: "preview",
      statement: "UPDATE acct SET balance = 999 WHERE id = 1",
    });
    const txnId = (p.structuredContent as any).txn_id;
    const r = await handler({ conn: pg.url, mode: "rollback", txn_id: txnId });
    expect((r.structuredContent as any).committed).toBe(false);
    expect(await balance()).toBe(100);
  });

  it("confirm with an unknown txn_id is a txn_not_found error", async () => {
    const handler = dbWriteTool.build(ctx);
    const res = await handler({ conn: pg.url, mode: "confirm", txn_id: "does-not-exist" });
    expect(res.isError).toBe(true);
    expect((res.structuredContent as any).code).toBe("txn_not_found");
  });

  it("auto-rolls-back an idle held transaction (sweep)", async () => {
    await resetBalance(100);
    // Use a realistic timeout so the Postgres-side idle backstop doesn't fire
    // mid-test; back-date lastActivity to drive the JS sweep deterministically.
    const idleReg = new PgSessionRegistry(engine, { idleTimeoutMs: 60_000 });
    const session = await idleReg.open(pg.url);
    await session.client.query("UPDATE acct SET balance = 777 WHERE id = 1");
    expect(idleReg.size()).toBe(1);
    session.lastActivity = Date.now() - 120_000; // simulate 2 min idle
    await idleReg.sweep();
    expect(idleReg.size()).toBe(0);
    expect(await balance()).toBe(100); // idle txn auto-rolled-back
    await idleReg.shutdown();
  });
});
