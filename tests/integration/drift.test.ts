import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { PgEngine } from "../../src/engine/PgEngine.js";
import { ArtifactStore } from "../../src/artifact/ArtifactStore.js";
import { PgSessionRegistry } from "../../src/session/PgSessionRegistry.js";
import { dbMigrateVerifyTool } from "../../src/tools/db_migrate_verify.js";
import type { ToolContext } from "../../src/tools/types.js";
import { startPg, dockerAvailable, type PgHandle } from "../helpers/pgContainer.js";

const hasDocker = await dockerAvailable();
const hasSqlAlchemy = (() => {
  try {
    execFileSync("python3", ["-c", "import sqlalchemy"], { stdio: "ignore", timeout: 5000 });
    return true;
  } catch {
    return false;
  }
})();

const MODELS = `from sqlalchemy.orm import declarative_base
from sqlalchemy import Column, Integer, String, Boolean

Base = declarative_base()

class User(Base):
    __tablename__ = "users"
    id = Column(Integer, primary_key=True)
    email = Column(String(255), nullable=False)
    is_active = Column(Boolean, nullable=False)
    full_name = Column(String(100), nullable=False)
`;

/* eslint-disable @typescript-eslint/no-explicit-any */
describe.skipIf(!hasDocker || !hasSqlAlchemy)("rolepod_db_migrate_verify (live PG + Python sidecar)", () => {
  let pg: PgHandle;
  let ctx: ToolContext;
  let projectDir: string;

  beforeAll(async () => {
    pg = await startPg();
    projectDir = mkdtempSync(join(tmpdir(), "dblab-models-"));
    writeFileSync(join(projectDir, "mymodels.py"), MODELS, "utf8");

    const engine = new PgEngine();
    // Live schema intentionally drifted from the model:
    //  - id bigint           (model Integer)      → type_mismatch
    //  - email nullable      (model NOT NULL)     → nullability_mismatch
    //  - full_name absent    (model has it)       → missing_column
    //  - is_active matches
    await engine.withConnection(pg.url, async (c) => {
      await c.query(
        `CREATE TABLE users (
           id bigint PRIMARY KEY,
           email varchar(255),
           is_active boolean NOT NULL
         )`,
      );
    });
    ctx = {
      engine,
      store: new ArtifactStore({ rootDir: mkdtempSync(join(tmpdir(), "dblab-d-")) }),
      registry: new PgSessionRegistry(engine),
    };
  }, 60_000);

  afterAll(async () => {
    await pg?.stop();
  });

  it("detects nullability + missing_column + type_mismatch via the real sidecar", async () => {
    const handler = dbMigrateVerifyTool.build(ctx);
    const res = await handler({
      conn: pg.url,
      schema: "public",
      models_entrypoint: "mymodels:Base",
      project_dir: projectDir,
    });
    expect(res.isError).toBeFalsy();
    const out = res.structuredContent as any;
    if (out.unverifiable) throw new Error(`expected verified drift, got unverifiable: ${out.reason}`);
    expect(out.passed).toBe(false);
    const classes: string[] = out.drift.map((d: any) => d.class);
    expect(classes).toContain("type_mismatch");
    expect(classes).toContain("nullability_mismatch");
    expect(classes).toContain("missing_column");

    const manifest = JSON.parse(readFileSync(out.manifest_path, "utf8"));
    expect(manifest.phase).toBe("review");
    expect(manifest.status).toBe("fail");
  });

  it("degrades to unverifiable on a bad models entrypoint (does not throw)", async () => {
    const handler = dbMigrateVerifyTool.build(ctx);
    const res = await handler({
      conn: pg.url,
      schema: "public",
      models_entrypoint: "nonexistent_module_xyz:Base",
      project_dir: projectDir,
    });
    expect(res.isError).toBeFalsy();
    const out = res.structuredContent as any;
    expect(out.unverifiable).toBe(true);
    expect(out.reason).toBeTruthy();
  });
});
