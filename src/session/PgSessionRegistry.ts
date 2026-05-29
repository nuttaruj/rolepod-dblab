import { randomUUID } from "node:crypto";
import type { PgEngine } from "../engine/PgEngine.js";
import type { PgSession } from "./PgSession.js";
import { RolepodMcpError } from "../util/errors.js";
import { log } from "../util/log.js";

/**
 * Holds open write transactions across tool calls (the db-write guard). Each
 * session owns a `pg` connection with a BEGIN in flight. Sessions left
 * unconfirmed are auto-rolled-back after `idleTimeoutMs` to bound how long row
 * locks linger if an agent abandons the ritual.
 *
 * Mirrors uiproof's SessionRegistry (which holds browser sessions across tool
 * calls) — the same cross-call-state pattern, applied to a transaction.
 */
export class PgSessionRegistry {
  private readonly sessions = new Map<string, PgSession>();
  private readonly idleTimeoutMs: number;
  private idleTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly engine: PgEngine,
    opts: { idleTimeoutMs?: number } = {},
  ) {
    // 5 min default — long enough for a preview→confirm turn, short enough to
    // not hold row locks indefinitely on an abandoned transaction.
    this.idleTimeoutMs = opts.idleTimeoutMs ?? 5 * 60 * 1000;
  }

  /** Open a connection, BEGIN, and register the held session. */
  async open(connectionString: string): Promise<PgSession> {
    const client = await this.engine.connect(connectionString);
    await client.query("BEGIN");
    // Defense-in-depth: Postgres aborts the transaction itself if it sits idle
    // past the timeout, independent of the JS sweep below — so a blocked Node
    // event loop can't let a held transaction keep its row locks indefinitely.
    if (this.idleTimeoutMs > 0) {
      await client
        .query(`SET idle_in_transaction_session_timeout = ${Math.floor(this.idleTimeoutMs)}`)
        .catch(() => undefined);
    }
    const now = Date.now();
    const session: PgSession = {
      id: randomUUID(),
      client,
      preview: null,
      startedAt: now,
      lastActivity: now,
    };
    this.sessions.set(session.id, session);
    this.ensureIdleSweep();
    return session;
  }

  /** Look up a live session and mark it active. */
  get(id: string): PgSession | undefined {
    const s = this.sessions.get(id);
    if (s) s.lastActivity = Date.now();
    return s;
  }

  /** COMMIT a held session and dispose it. Throws if the id is unknown. */
  async commit(id: string): Promise<void> {
    const s = this.require(id);
    try {
      await s.client.query("COMMIT");
    } finally {
      await this.dispose(id);
    }
  }

  /** ROLLBACK a held session and dispose it. No-op if already gone. */
  async rollback(id: string): Promise<void> {
    const s = this.sessions.get(id);
    if (!s) return;
    try {
      await s.client.query("ROLLBACK").catch(() => undefined);
    } finally {
      await this.dispose(id);
    }
  }

  /** Roll back any session idle longer than the timeout. Public for testing. */
  async sweep(): Promise<void> {
    const now = Date.now();
    for (const [id, s] of [...this.sessions]) {
      if (now - s.lastActivity >= this.idleTimeoutMs) {
        log.warn("auto-rolling-back idle write transaction", {
          txn_id: id,
          idle_ms: now - s.lastActivity,
        });
        await this.rollback(id);
      }
    }
  }

  /** Roll back and close every held session (server shutdown). */
  async shutdown(): Promise<void> {
    for (const id of [...this.sessions.keys()]) {
      await this.rollback(id);
    }
    if (this.idleTimer) {
      clearInterval(this.idleTimer);
      this.idleTimer = null;
    }
  }

  size(): number {
    return this.sessions.size;
  }

  private require(id: string): PgSession {
    const s = this.sessions.get(id);
    if (!s) {
      throw new RolepodMcpError("txn_not_found", `No held transaction with id "${id}".`);
    }
    s.lastActivity = Date.now();
    return s;
  }

  private async dispose(id: string): Promise<void> {
    const s = this.sessions.get(id);
    if (!s) return;
    this.sessions.delete(id);
    await s.client.end().catch(() => undefined);
    if (this.sessions.size === 0 && this.idleTimer) {
      clearInterval(this.idleTimer);
      this.idleTimer = null;
    }
  }

  private ensureIdleSweep(): void {
    if (this.idleTimer) return;
    const interval = Math.max(30_000, Math.floor(this.idleTimeoutMs / 4));
    this.idleTimer = setInterval(() => void this.sweep(), interval);
    this.idleTimer.unref?.();
  }
}
