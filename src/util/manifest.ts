import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { log } from "./log.js";

/**
 * Extension Protocol v1 — manifest.json schema.
 *
 * Parent `rolepod` plugin's `check-work` skill scans `.rolepod/evidence/` for
 * `manifest.json` files and aggregates them into the verify report. dblab
 * writes one in BOTH standalone and with-parent modes — uniform surface, and a
 * user who later installs the parent gets historic artifacts already shaped.
 */
export const ROLEPOD_PROTOCOL_VERSION = "rolepod/v1" as const;
export const PLUGIN_NAME = "rolepod-dblab" as const;

export type ManifestPhase = "verify" | "debug" | "build" | "review";
export type ManifestStatus = "pass" | "fail" | "warn";

export type ManifestArtifact = {
  type: string;
  path: string;
};

export type ManifestInput = {
  runDir: string;
  skill: string;
  phase: ManifestPhase;
  status: ManifestStatus;
  summary: string;
  startedAt: string;
  finishedAt: string;
  artifacts: ManifestArtifact[];
  metadata?: Record<string, unknown>;
};

export type Manifest = {
  protocol: typeof ROLEPOD_PROTOCOL_VERSION;
  plugin: typeof PLUGIN_NAME;
  skill: string;
  phase: ManifestPhase;
  status: ManifestStatus;
  summary: string;
  started_at: string;
  finished_at: string;
  artifacts: ManifestArtifact[];
  metadata: Record<string, unknown>;
};

/**
 * Write manifest.json next to the run's other artifacts. Best-effort: any IO
 * failure is logged but never thrown — a missing manifest must not fail an
 * otherwise-successful tool call.
 *
 * Caller MUST keep connection strings and SQL parameters out of `metadata` —
 * the manifest is written to disk and may be read by the parent.
 */
export async function writeManifest(input: ManifestInput): Promise<string | undefined> {
  const manifest: Manifest = {
    protocol: ROLEPOD_PROTOCOL_VERSION,
    plugin: PLUGIN_NAME,
    skill: input.skill,
    phase: input.phase,
    status: input.status,
    summary: input.summary,
    started_at: input.startedAt,
    finished_at: input.finishedAt,
    artifacts: input.artifacts,
    metadata: input.metadata ?? {},
  };
  const path = resolve(input.runDir, "manifest.json");
  try {
    await writeFile(path, JSON.stringify(manifest, null, 2), "utf8");
    return path;
  } catch (err) {
    log.warn("manifest write failed", { run_dir: input.runDir, skill: input.skill, err: String(err) });
    return undefined;
  }
}
