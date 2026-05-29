import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import type { DriftColumn, DriftTable, NormalizedSchema } from "./types.js";

const pexec = promisify(execFile);

export type ReflectOptions = {
  modelsEntrypoint?: string;
  snapshotPath?: string;
  python?: string;
  cwd?: string;
};

export type ReflectResult =
  | { ok: true; schema: NormalizedSchema; source: "models" | "snapshot" }
  | { ok: false; reason: string };

/**
 * Reflect the declared schema. Three modes, in priority order:
 *   1. native (models_entrypoint) — run reflect_models.py in the user's interpreter.
 *   2. snapshot (snapshot_path)   — read a pre-generated normalized JSON.
 *   3. neither                    — unverifiable.
 * Never throws: import/IO failures degrade to `{ ok: false, reason }` so the
 * other four skills are unaffected (graceful degrade, SPEC §10).
 */
export async function reflectModels(opts: ReflectOptions): Promise<ReflectResult> {
  if (opts.modelsEntrypoint) {
    const script = findSidecarScript();
    if (!script) return { ok: false, reason: "reflect_models.py sidecar not found in the package" };
    const python = opts.python ?? "python3";
    try {
      const { stdout } = await pexec(python, [script, "--models", opts.modelsEntrypoint], {
        cwd: opts.cwd ?? process.cwd(),
        timeout: 15000,
      });
      return { ok: true, schema: coerceSchema(JSON.parse(stdout)), source: "models" };
    } catch (err) {
      return { ok: false, reason: extractReason(err) };
    }
  }

  if (opts.snapshotPath) {
    try {
      const raw = await readFile(opts.snapshotPath, "utf8");
      return { ok: true, schema: coerceSchema(JSON.parse(raw)), source: "snapshot" };
    } catch (err) {
      return { ok: false, reason: `could not read snapshot at ${opts.snapshotPath}: ${extractReason(err)}` };
    }
  }

  return { ok: false, reason: "provide models_entrypoint (module:attr) or snapshot_path" };
}

/** Locate reflect_models.py — sibling in dev (src/drift/), under src/ in a published package. */
function findSidecarScript(): string | null {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 6; i++) {
    for (const rel of ["reflect_models.py", "drift/reflect_models.py", "src/drift/reflect_models.py"]) {
      const candidate = resolve(dir, rel);
      if (existsSync(candidate)) return candidate;
    }
    dir = dirname(dir);
  }
  return null;
}

function extractReason(err: unknown): string {
  if (err && typeof err === "object") {
    const e = err as { stderr?: string; message?: string };
    if (e.stderr && e.stderr.trim()) return e.stderr.trim();
    if (e.message) return e.message;
  }
  return String(err);
}

/** Defensively coerce parsed JSON into NormalizedSchema. */
function coerceSchema(parsed: unknown): NormalizedSchema {
  const root = parsed as { tables?: unknown };
  if (!root || !Array.isArray(root.tables)) {
    throw new Error("reflected schema has no `tables` array");
  }
  const tables: DriftTable[] = root.tables.map((t) => {
    const tt = t as { name?: unknown; columns?: unknown };
    const cols = Array.isArray(tt.columns) ? tt.columns : [];
    const columns: DriftColumn[] = cols.map((c) => {
      const cc = c as { name?: unknown; type?: unknown; nullable?: unknown };
      return { name: String(cc.name), type: String(cc.type), nullable: Boolean(cc.nullable) };
    });
    return { name: String(tt.name), columns };
  });
  return { tables };
}
