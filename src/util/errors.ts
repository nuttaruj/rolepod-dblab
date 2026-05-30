/**
 * Structured error types surfaced to MCP clients. Each carries a stable
 * `code` plus enough `detail` for the Lead agent to recover (re-connect,
 * supply a snapshot, confirm/rollback a held transaction, etc.).
 *
 * Connection strings and statement parameters are secrets — never place a
 * raw connection string in `message` or `detail`. Redact before constructing.
 */

export type ErrorCode =
  | "invalid_input"
  | "engine_error" // pg not installed / connect failed
  | "query_error" // SQL execution failed
  | "read_only_violation" // a write was attempted inside a READ ONLY query
  | "txn_held" // a held transaction already exists for this session
  | "txn_not_found" // confirm/rollback referenced an unknown txn_id
  | "drift_unverifiable" // sidecar could not reflect models and no snapshot given
  | "unsupported_engine"
  | "not_implemented";

export class RolepodMcpError extends Error {
  override readonly name = "RolepodMcpError";
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly detail?: Record<string, unknown>,
  ) {
    super(message);
  }

  toJSON(): { code: ErrorCode; message: string; detail?: Record<string, unknown> } {
    return {
      code: this.code,
      message: this.message,
      ...(this.detail ? { detail: this.detail } : {}),
    };
  }
}

/**
 * Scrub any Postgres connection URI (which carries the password) out of a
 * string before it reaches logs or MCP clients. The single source of truth for
 * what a redacted secret looks like — used by the engine's connect-error path
 * and as a defensive net in the tool failure serializer, so a leak can't slip
 * through if a future throw site forgets to redact.
 */
export function scrubConnUri(s: string): string {
  return s.replace(/postgres(?:ql)?:\/\/\S+/gi, "<connection-string>");
}
