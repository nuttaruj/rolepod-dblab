import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { RolepodMcpError, scrubConnUri } from "../util/errors.js";

/**
 * Pack a successful tool result into the MCP wire format. The same value is
 * emitted both as a text content block (for the Lead to read) and as
 * `structuredContent` (for any client that prefers typed JSON).
 */
export function ok(value: unknown): CallToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
    structuredContent: value as Record<string, unknown>,
  };
}

/**
 * Pack a structured error. RolepodMcpError surfaces a stable error code +
 * detail bag; anything else degrades to "engine_error" with the message.
 */
export function failure(err: unknown): CallToolResult {
  if (err instanceof RolepodMcpError) {
    const payload = err.toJSON();
    return {
      isError: true,
      content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
      structuredContent: payload as unknown as Record<string, unknown>,
    };
  }
  // Defensive: scrub any connection URI in case a raw (non-RolepodMcpError)
  // throw site carried one — the engine redacts at its connect path, this is
  // the belt-and-suspenders net for every other error reaching a client.
  const message = scrubConnUri(err instanceof Error ? err.message : String(err));
  const payload = { code: "engine_error" as const, message };
  return {
    isError: true,
    content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
    structuredContent: payload as unknown as Record<string, unknown>,
  };
}

/** Wrap a handler so any thrown error is converted to a structured failure. */
export function safeHandler<Args>(
  fn: (args: Args) => Promise<CallToolResult>,
): (args: Args) => Promise<CallToolResult> {
  return async (args: Args) => {
    try {
      return await fn(args);
    } catch (err) {
      return failure(err);
    }
  };
}
