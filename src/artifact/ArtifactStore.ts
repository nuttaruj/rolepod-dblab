import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { log } from "../util/log.js";
import { detectRolepodParent } from "../util/rolepodProtocol.js";

/**
 * Writes run artifacts (JSON reports + manifest.json).
 *
 * - **standalone** (default): `./.rolepod-dblab/artifacts/{skill}_{ts}_{uuid}/`
 * - **with-parent** (marker `<git-root>/.rolepod/parent-active` present):
 *   `<git-root>/.rolepod/evidence/{ts}-rolepod-dblab-{skill}/` — per Extension
 *   Protocol v1, so the parent `rolepod` plugin's `check-work` aggregates it.
 *
 * With-parent runs anchor at the git root so a skill invoked from a
 * subdirectory still lands where `check-work` looks. dblab evidence is JSON
 * (schema snapshots, query assertions, plans, drift reports) — there are no
 * screenshots or baselines, so this store is intentionally smaller than the
 * uiproof one.
 */
export type ArtifactMode = "standalone" | "with-parent";

export type StartRunResult = {
  runId: string;
  runDir: string;
  skill: string;
  mode: ArtifactMode;
};

export class ArtifactStore {
  readonly rootDir: string;
  readonly mode: ArtifactMode;

  constructor(opts: { rootDir?: string; mode?: ArtifactMode } = {}) {
    const parent = detectRolepodParent();
    this.mode = opts.mode ?? (parent.active ? "with-parent" : "standalone");

    if (opts.rootDir !== undefined) {
      this.rootDir = opts.rootDir;
    } else if (this.mode === "with-parent") {
      this.rootDir = resolve(parent.gitRoot, ".rolepod", "evidence");
    } else {
      this.rootDir = resolve(process.cwd(), ".rolepod-dblab", "artifacts");
    }
  }

  /** Allocate a fresh run dir and ensure it exists. */
  async startRun(skill: string): Promise<StartRunResult> {
    const ts = this.timestampSlug();
    const runId =
      this.mode === "with-parent"
        ? `${ts}-rolepod-dblab-${skill}`
        : `${skill}_${ts}_${randomUUID().slice(0, 8)}`;
    const runDir = resolve(this.rootDir, runId);
    await mkdir(runDir, { recursive: true });
    log.debug("artifact run started", { run_id: runId, dir: runDir, mode: this.mode, skill });
    return { runId, runDir, skill, mode: this.mode };
  }

  /** Write a named text/JSON report into the run dir; returns its path. */
  async writeReport(runDir: string, name: string, body: string): Promise<string> {
    const path = resolve(runDir, name);
    await writeFile(path, body, "utf8");
    return path;
  }

  private timestampSlug(): string {
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    return (
      `${d.getUTCFullYear()}` +
      pad(d.getUTCMonth() + 1) +
      pad(d.getUTCDate()) +
      "T" +
      pad(d.getUTCHours()) +
      pad(d.getUTCMinutes()) +
      pad(d.getUTCSeconds())
    );
  }
}
