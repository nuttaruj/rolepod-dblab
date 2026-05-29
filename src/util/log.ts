/**
 * Stdio MCP servers MUST NOT write logs to stdout — stdout carries
 * JSON-RPC. All diagnostic output goes to stderr.
 *
 * Reference: MCP TypeScript SDK README, "Logging on stdio servers".
 */

function emit(level: "info" | "warn" | "error" | "debug", msg: string, extra?: unknown): void {
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    msg,
    ...(extra !== undefined ? { extra } : {}),
  });
  process.stderr.write(line + "\n");
}

export const log = {
  info: (msg: string, extra?: unknown) => emit("info", msg, extra),
  warn: (msg: string, extra?: unknown) => emit("warn", msg, extra),
  error: (msg: string, extra?: unknown) => emit("error", msg, extra),
  debug: (msg: string, extra?: unknown) => {
    if (process.env.ROLEPOD_DBLAB_DEBUG) emit("debug", msg, extra);
  },
};
