import { PgEngine } from "../engine/PgEngine.js";

/**
 * `rolepod-dblab test-connection <connection-string>` — verify the server can
 * reach a Postgres and report its version. Exits 0 on success, 1 on failure.
 * The connection string is a secret: it is never echoed back.
 */
export async function runTestConnection(connectionString: string): Promise<number> {
  const engine = new PgEngine();
  try {
    const version = await engine.serverVersion(connectionString);
    process.stdout.write(`✓ connected\n  ${version}\n`);
    return 0;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    process.stdout.write(`✗ connection failed: ${message}\n`);
    return 1;
  }
}
