#!/usr/bin/env node
// Emit dist/schemas/tools.json — JSON-Schema definitions for every
// rolepod_db_* tool exposed by the MCP server. Run via `npm run
// build:schemas` AFTER `tsup` (chained in `npm run build`), so it reads the
// freshly built dist/index.js.
//
// The `pairs` list is empty until the tools land (T4–T10). With no pairs it
// writes an empty tool set — keeping `npm run build` green from T1 onward.

import { mkdir, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { zodToJsonSchema } from "zod-to-json-schema";

const here = dirname(fileURLToPath(import.meta.url));
const distEntry = resolve(here, "..", "dist", "index.js");

const lib = await import(distEntry);

// [exportKey, zodSchema] — exportKey must have a matching ToolNames entry.
const pairs = [
  ["dbIntrospect", lib.dbIntrospectSchema],
  ["dbQuery", lib.dbQuerySchema],
  ["dbExplain", lib.dbExplainSchema],
  ["dbMigrateVerify", lib.dbMigrateVerifySchema],
  ["dbWrite", lib.dbWriteSchema],
];

const tools = {};
for (const [key, schema] of pairs) {
  const toolName = lib.ToolNames?.[key];
  if (!toolName) {
    console.error(`Missing ToolNames entry for ${key}`);
    process.exit(1);
  }
  tools[toolName] = zodToJsonSchema(schema, { target: "jsonSchema2019-09" });
}

const out = {
  $schema: "https://json-schema.org/draft/2019-09/schema",
  rolepod_mcp_version: lib.SERVER_VERSION,
  tools,
};

const outDir = resolve(here, "..", "dist", "schemas");
await mkdir(outDir, { recursive: true });
const outPath = resolve(outDir, "tools.json");
await writeFile(outPath, JSON.stringify(out, null, 2), "utf8");
console.log(`Wrote ${Object.keys(tools).length} schemas → ${outPath}`);
