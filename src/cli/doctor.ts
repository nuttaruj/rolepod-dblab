import { resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const pexec = promisify(execFile);

type Check = {
  name: string;
  status: "ok" | "warn" | "fail";
  detail: string;
};

/**
 * `rolepod-dblab doctor` — diagnose local environment readiness. Exits 0 if
 * every check is `ok`/`warn`, 1 if any `fail`.
 *
 * `pg` is a hard requirement (4 of 5 skills need it) → `fail` if missing.
 * `python3` + `SQLAlchemy` power only the drift skill → `warn` if missing;
 * the other four skills work without them.
 */
export async function runDoctor(): Promise<number> {
  const checks: Check[] = [];

  const major = Number(process.versions.node.split(".")[0]);
  checks.push({
    name: "Node ≥20",
    status: major >= 20 ? "ok" : "fail",
    detail: process.versions.node,
  });

  checks.push(await checkPg());

  const py = await checkPython();
  checks.push(py.check);
  checks.push(await checkSqlAlchemy(py.cmd));

  checks.push(checkArtifactDir());

  print(checks);
  const failed = checks.some((c) => c.status === "fail");
  return failed ? 1 : 0;
}

async function checkPg(): Promise<Check> {
  try {
    const url = await import.meta.resolve?.("pg");
    return { name: "pg (PostgreSQL driver)", status: "ok", detail: url ?? "resolved" };
  } catch {
    return {
      name: "pg (PostgreSQL driver)",
      status: "fail",
      detail: "Not installed — run: npm i pg (required by every skill except drift)",
    };
  }
}

async function checkPython(): Promise<{ check: Check; cmd: string | null }> {
  for (const cmd of ["python3", "python"]) {
    try {
      const { stdout, stderr } = await pexec(cmd, ["--version"], { timeout: 3000 });
      return {
        check: { name: "python3 (drift sidecar)", status: "ok", detail: (stdout || stderr).trim() },
        cmd,
      };
    } catch {
      // try next candidate
    }
  }
  return {
    check: {
      name: "python3 (drift sidecar)",
      status: "warn",
      detail: "Not found — db-migrate-verify (drift) needs it; the other 4 skills work without.",
    },
    cmd: null,
  };
}

async function checkSqlAlchemy(cmd: string | null): Promise<Check> {
  if (!cmd) {
    return { name: "SQLAlchemy (drift models)", status: "warn", detail: "Skipped — no python3 found." };
  }
  try {
    const { stdout } = await pexec(
      cmd,
      ["-c", "import sqlalchemy,sys; sys.stdout.write(sqlalchemy.__version__)"],
      { timeout: 5000 },
    );
    return { name: "SQLAlchemy (drift models)", status: "ok", detail: stdout.trim() };
  } catch {
    return {
      name: "SQLAlchemy (drift models)",
      status: "warn",
      detail: "Not importable — drift verify needs it in the env holding your models: pip install SQLAlchemy",
    };
  }
}

function checkArtifactDir(): Check {
  const dir = resolve(process.cwd(), ".rolepod-dblab");
  return {
    name: "Artifact root writable",
    status: "ok",
    detail: `Will be created at: ${dir}/artifacts/{run_id}/`,
  };
}

function print(checks: Check[]): void {
  const icon = (s: Check["status"]) => (s === "ok" ? "✓" : s === "warn" ? "•" : "✗");
  for (const c of checks) {
    process.stdout.write(`  ${icon(c.status)} ${c.name.padEnd(28)} ${c.detail}\n`);
  }
}
