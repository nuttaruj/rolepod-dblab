#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { runDoctor } from "../src/cli/doctor.js";
import { runTestConnection } from "../src/cli/testConnection.js";
import { buildServer } from "../src/server.js";
import { SERVER_VERSION } from "../src/version.js";
import { log } from "../src/util/log.js";

const HELP = `rolepod-dblab ${SERVER_VERSION}

Usage:
  rolepod-dblab [serve]                    Start the MCP server on stdio (default)
  rolepod-dblab doctor                     Check the local environment (Node, pg, python3, SQLAlchemy)
  rolepod-dblab test-connection <connstr>  Connect to a Postgres and print its version
  rolepod-dblab --version                  Print the version
  rolepod-dblab --help                     Show this help
`;

async function main(): Promise<void> {
  const [, , sub, ...rest] = process.argv;

  switch (sub) {
    case undefined:
    case "serve":
      return startServer();
    case "doctor":
      process.exit(await runDoctor());
    case "test-connection": {
      const conn = rest[0];
      if (!conn) {
        process.stderr.write("Usage: rolepod-dblab test-connection <connection-string>\n");
        process.exit(2);
      }
      process.exit(await runTestConnection(conn));
    }
    case "--version":
    case "-v":
      process.stdout.write(`${SERVER_VERSION}\n`);
      return;
    case "--help":
    case "-h":
    case "help":
      process.stdout.write(HELP);
      return;
    default:
      process.stderr.write(`Unknown subcommand: ${sub}\n${HELP}`);
      process.exit(2);
  }
}

async function startServer(): Promise<void> {
  const server = buildServer();
  const transport = new StdioServerTransport();

  const shutdown = async (signal: NodeJS.Signals) => {
    log.info("shutting down", { signal });
    await server.shutdown().catch((err: unknown) => log.error("shutdown failed", { err: String(err) }));
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));

  await server.mcp.connect(transport);
  log.info("rolepod-dblab connected on stdio");
}

main().catch((err: unknown) => {
  log.error("fatal startup error", { err: err instanceof Error ? err.stack : String(err) });
  process.exit(1);
});
