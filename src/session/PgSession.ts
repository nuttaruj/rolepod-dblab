import type { Client } from "pg";

/**
 * A held write transaction. The MCP server keeps the `pg` connection open
 * across tool calls (preview → confirm/rollback) with a BEGIN in flight — the
 * statement is applied inside the transaction but not committed until an
 * explicit confirm. This cross-call state is why dblab is an MCP plugin, not a
 * prompt-only skill (a skill cannot hold a transaction open across turns).
 */
export type PgSessionPreview = {
  statement: string;
  affected_rows: number;
  returned: Array<Record<string, unknown>>;
  before_sample: Array<Record<string, unknown>>;
  after_sample: Array<Record<string, unknown>>;
};

export type PgSession = {
  readonly id: string;
  readonly client: Client;
  preview: PgSessionPreview | null;
  readonly startedAt: number;
  lastActivity: number;
};
