import { z, type ZodRawShape, type ZodObject } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { PgEngine } from "../engine/PgEngine.js";
import type { ArtifactStore } from "../artifact/ArtifactStore.js";
import type { PgSessionRegistry } from "../session/PgSessionRegistry.js";

/**
 * The live context handed to every tool's `build(ctx)`. Tools destructure only
 * what they use:
 *   - `engine`   — PgEngine for stateless connect / query / introspect / explain
 *   - `store`    — ArtifactStore for evidence + manifest routing
 *   - `registry` — PgSessionRegistry for the held-transaction write-guard
 */
export type ToolContext = {
  engine: PgEngine;
  store: ArtifactStore;
  registry: PgSessionRegistry;
};

/** Derive the parsed-args type from a raw shape via Zod inference. */
export type ParsedArgs<Shape extends ZodRawShape> = z.infer<ZodObject<Shape>>;

/**
 * The shape every tool module exports. The server iterates these and binds
 * them to the live `ToolContext` via `build(ctx)`.
 */
export type ToolModule<Shape extends ZodRawShape> = {
  name: string;
  description: string;
  inputShape: Shape;
  build(ctx: ToolContext): (args: ParsedArgs<Shape>) => Promise<CallToolResult>;
};
