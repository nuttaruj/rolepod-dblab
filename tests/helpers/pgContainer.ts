import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { PgEngine } from "../../src/engine/PgEngine.js";

const pexec = promisify(execFile);
let counter = 0;

export type PgHandle = {
  url: string;
  stop: () => Promise<void>;
};

/** True if a docker daemon is reachable — integration tests skip otherwise. */
export async function dockerAvailable(): Promise<boolean> {
  try {
    await pexec("docker", ["info"], { timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * Boot a throwaway Postgres in docker and return a connection string. Real DB,
 * not a mock (integration tests prove behavior against actual Postgres). The
 * container is `--rm` and stopped in `stop()`.
 */
export async function startPg(): Promise<PgHandle> {
  const name = `dblab-test-${process.pid}-${counter++}`;
  await pexec("docker", [
    "run", "-d", "--rm", "--name", name,
    "-e", "POSTGRES_PASSWORD=postgres",
    "-e", "POSTGRES_DB=dblab_test",
    "-P", "postgres:16-alpine",
  ]);

  const stop = async () => {
    await pexec("docker", ["stop", name]).catch(() => undefined);
  };

  try {
    const { stdout } = await pexec("docker", ["port", name, "5432/tcp"]);
    const portLine = stdout.split("\n").map((s) => s.trim()).find(Boolean) ?? "";
    const port = portLine.split(":").pop();
    if (!port) throw new Error(`could not parse mapped port from: ${stdout}`);
    const url = `postgresql://postgres:postgres@127.0.0.1:${port}/dblab_test`;

    const engine = new PgEngine();
    const deadline = Date.now() + 30_000;
    let lastErr: unknown;
    while (Date.now() < deadline) {
      try {
        await engine.serverVersion(url);
        return { url, stop };
      } catch (err) {
        lastErr = err;
        await new Promise((r) => setTimeout(r, 500));
      }
    }
    throw new Error(`postgres not ready within 30s: ${String(lastErr)}`);
  } catch (err) {
    await stop();
    throw err;
  }
}
