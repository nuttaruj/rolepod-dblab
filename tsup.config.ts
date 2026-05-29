import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    "bin/rolepod-dblab": "bin/rolepod-dblab.ts",
  },
  format: ["esm"],
  target: "node20",
  platform: "node",
  outDir: "dist",
  clean: true,
  dts: true,
  sourcemap: true,
  splitting: false,
  shims: false,
  // Keep all third-party packages as runtime imports so:
  //  - the DB driver (pg) is lazy-loaded at first connect, not pulled into the static bundle
  //  - users can swap pinned versions without rebuilding
  noExternal: [],
  external: ["@modelcontextprotocol/sdk", "pg", "zod"],
});
