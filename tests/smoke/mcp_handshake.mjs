import { spawn } from "node:child_process";
import { resolve } from "node:path";

const bin = resolve(process.cwd(), "dist/bin/rolepod-dblab.js");
const child = spawn("node", [bin], { stdio: ["pipe", "pipe", "inherit"] });

function send(obj) {
  child.stdin.write(JSON.stringify(obj) + "\n");
}

let buf = "";
const pending = new Map();
let nextId = 1;
function call(method, params = {}) {
  const id = nextId++;
  return new Promise((resolveResp) => {
    pending.set(id, resolveResp);
    send({ jsonrpc: "2.0", id, method, params });
  });
}

child.stdout.on("data", (chunk) => {
  buf += chunk.toString("utf8");
  let nl;
  while ((nl = buf.indexOf("\n")) !== -1) {
    const line = buf.slice(0, nl).trim();
    buf = buf.slice(nl + 1);
    if (!line) continue;
    try {
      const msg = JSON.parse(line);
      if (msg.id && pending.has(msg.id)) {
        pending.get(msg.id)(msg);
        pending.delete(msg.id);
      }
    } catch (err) {
      console.error("parse fail:", err, line);
    }
  }
});

function fail(reason) {
  console.error("SMOKE FAIL:", reason);
  child.kill("SIGTERM");
  process.exit(1);
}

const initResp = await call("initialize", {
  protocolVersion: "2024-11-05",
  capabilities: {},
  clientInfo: { name: "smoke", version: "0" },
});
const info = initResp.result?.serverInfo;
console.log("[init]", JSON.stringify(info));
if (info?.name !== "rolepod-dblab") fail(`unexpected serverInfo.name: ${info?.name}`);
if (!info?.version) fail("missing serverInfo.version");

send({ jsonrpc: "2.0", method: "notifications/initialized", params: {} });

const listResp = await call("tools/list", {});
const names = (listResp.result?.tools ?? []).map((t) => t.name);
console.log("[tools]", names.join(", ") || "(none)");

const expected = [
  "rolepod_db_introspect",
  "rolepod_db_query",
  "rolepod_db_explain",
  "rolepod_db_write",
  "rolepod_db_migrate_verify",
];
const missing = expected.filter((n) => !names.includes(n));
if (missing.length) fail(`MISSING tools: ${missing.join(", ")}`);

console.log("OK");
child.kill("SIGTERM");
setTimeout(() => process.exit(0), 200);
