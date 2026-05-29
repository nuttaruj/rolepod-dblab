import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ArtifactStore } from "./artifact/ArtifactStore.js";
import { PgEngine } from "./engine/PgEngine.js";
import { PgSessionRegistry } from "./session/PgSessionRegistry.js";
import { tools } from "./tools/index.js";
import { toolMetadata } from "./tools/metadata.js";
import type { ToolContext } from "./tools/types.js";
import { SERVER_NAME, SERVER_VERSION } from "./version.js";
import { log } from "./util/log.js";
import { detectRolepodParent } from "./util/rolepodProtocol.js";

/**
 * Extension Protocol version this build implements. Compared at server start
 * against the marker file content written by the parent `rolepod` plugin.
 */
export const SUPPORTED_PROTOCOL = "v1" as const;

/**
 * Warn (don't fail) when the parent signals a protocol version we don't
 * implement — the manifest is still written in our shape, but the parent may
 * not parse it. Throwing would break older parents with no marker at all.
 */
function checkProtocolCompat(): void {
  const parent = detectRolepodParent();
  if (!parent.active || !parent.protocol) return;
  if (parent.protocol !== SUPPORTED_PROTOCOL) {
    log.warn("rolepod protocol mismatch", {
      expected: SUPPORTED_PROTOCOL,
      got: parent.protocol,
    });
  }
}

export type ServerHandle = {
  mcp: McpServer;
  registry: PgSessionRegistry;
  shutdown(): Promise<void>;
};

/**
 * Build the MCP server with every registered tool. Caller chooses a
 * transport (stdio for production, in-memory for tests) and invokes
 * `mcp.connect(transport)`.
 *
 * The `ToolContext` grows across the build (engine T3, store T4, registry
 * T7); `shutdown()` will close those subsystems as they are added.
 */
export function buildServer(opts: { artifactRoot?: string; idleTimeoutMs?: number } = {}): ServerHandle {
  checkProtocolCompat();

  const engine = new PgEngine();
  const storeOpts: ConstructorParameters<typeof ArtifactStore>[0] = {};
  if (opts.artifactRoot !== undefined) storeOpts.rootDir = opts.artifactRoot;
  const store = new ArtifactStore(storeOpts);
  const registry = new PgSessionRegistry(engine, opts.idleTimeoutMs !== undefined ? { idleTimeoutMs: opts.idleTimeoutMs } : {});
  const ctx: ToolContext = { engine, store, registry };

  const mcp = new McpServer({
    name: SERVER_NAME,
    version: SERVER_VERSION,
  });

  for (const t of tools) {
    const meta = toolMetadata[t.name];
    mcp.registerTool(
      t.name,
      {
        title: meta?.title,
        description: t.description,
        inputSchema: t.inputShape,
        annotations: meta?.annotations,
      },
      // The SDK's ToolCallback is (args, extra) => …; our handler is (args) => Promise<CallToolResult>.
      // JS ignores the unused `extra` (AbortSignal/authInfo — not needed in v1), and the return type
      // already matches, so the cast is safe. Revisit if a tool needs cancellation/auth context.
      t.build(ctx) as Parameters<typeof mcp.registerTool>[2],
    );
  }

  log.info("rolepod-dblab server built", {
    version: SERVER_VERSION,
    protocol: SUPPORTED_PROTOCOL,
    mode: store.mode,
    tools: tools.map((t) => t.name),
  });

  return {
    mcp,
    registry,
    async shutdown() {
      await registry.shutdown();
      await mcp.close().catch(() => undefined);
    },
  };
}
