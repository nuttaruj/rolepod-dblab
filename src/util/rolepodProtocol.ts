import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Extension Protocol — detection of the parent `rolepod` plugin.
 *
 * # Why a marker file (and not an env var)
 *
 * Env vars set by the parent's SessionStart hook do not propagate to the MCP
 * server subprocess Claude later spawns. So detection uses a filesystem marker
 * the parent writes:
 *
 *   <git-root>/.rolepod/parent-active
 *
 * Content (UTF-8, single trimmed line): the protocol version string. v1 ships
 * `"v1"`. The marker is removed by the parent's Stop hook.
 *
 * Detection is read-on-demand (no caching); the existsSync check is
 * sub-millisecond and runs at most twice per server boot.
 */
export interface ParentState {
  /** True iff the marker file exists. */
  active: boolean;
  /** First trimmed line of the marker (the protocol version), or null. */
  protocol: string | null;
  /** Resolved git root (or `cwd` fallback when not in a git work tree). */
  gitRoot: string;
}

export function detectRolepodParent(cwd: string = process.cwd()): ParentState {
  let gitRoot = cwd;
  try {
    gitRoot = execSync("git rev-parse --show-toplevel", {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    // non-git project — keep cwd. The marker can't exist outside a repo anyway.
  }

  const file = join(gitRoot, ".rolepod", "parent-active");
  if (!existsSync(file)) {
    return { active: false, protocol: null, gitRoot };
  }

  const protocol = readFileSync(file, "utf8").trim().split(/\r?\n/)[0] ?? null;
  return { active: true, protocol, gitRoot };
}

/**
 * Manual-override hint (documentation only). Force combined mode without a
 * real parent session:  `mkdir -p .rolepod && echo v1 > .rolepod/parent-active`
 * Force back to standalone:  `rm -f .rolepod/parent-active`
 */
export const MARKER_RELPATH = ".rolepod/parent-active" as const;
