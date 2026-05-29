// Single source of truth for the server identity. Imported by both the
// MCP server (src/server.ts) and the public library surface (src/index.ts)
// to avoid a circular dependency between them.
export const SERVER_NAME = "rolepod-dblab";
export const SERVER_VERSION = "0.1.0";
