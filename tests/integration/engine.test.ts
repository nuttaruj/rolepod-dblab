import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PgEngine } from "../../src/engine/PgEngine.js";
import { startPg, dockerAvailable, type PgHandle } from "../helpers/pgContainer.js";

const hasDocker = await dockerAvailable();

describe.skipIf(!hasDocker)("PgEngine (live Postgres)", () => {
  let pg: PgHandle;

  beforeAll(async () => {
    pg = await startPg();
  }, 60_000);

  afterAll(async () => {
    await pg?.stop();
  });

  it("connects and reports the server version", async () => {
    const engine = new PgEngine();
    const version = await engine.serverVersion(pg.url);
    expect(version).toMatch(/PostgreSQL/);
  });

  it("runs a trivial SELECT through withConnection", async () => {
    const engine = new PgEngine();
    const one = await engine.withConnection(pg.url, async (c) => {
      const r = await c.query<{ n: number }>("SELECT 1 AS n");
      return r.rows[0]?.n;
    });
    expect(one).toBe(1);
  });

  it("introspects a seeded schema into the normalized snapshot", async () => {
    const engine = new PgEngine();
    await engine.withConnection(pg.url, async (c) => {
      await c.query(`CREATE TABLE author (id serial PRIMARY KEY, name text NOT NULL)`);
      await c.query(
        `CREATE TABLE book (
           id serial PRIMARY KEY,
           title varchar(255) NOT NULL,
           author_id integer NOT NULL REFERENCES author(id)
         )`,
      );
      await c.query(`CREATE INDEX book_author_idx ON book(author_id)`);
    });

    const snap = await engine.introspectSchema(pg.url, { schema: "public" });
    const book = snap.tables.find((t) => t.name === "book");
    expect(book).toBeDefined();

    const title = book!.columns.find((c) => c.name === "title");
    expect(title?.type).toBe("character varying(255)");
    expect(title?.nullable).toBe(false);

    const id = book!.columns.find((c) => c.name === "id");
    expect(id?.primaryKey).toBe(true);

    expect(book!.foreignKeys[0]?.refTable).toBe("author");
    expect(book!.foreignKeys[0]?.columns).toContain("author_id");
    expect(book!.indexes.some((i) => i.columns.includes("author_id"))).toBe(true);
  });
});

if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn("[engine.test] docker not available — skipping live Postgres integration tests");
}
