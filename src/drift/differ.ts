import type { DriftFinding, NormalizedSchema } from "./types.js";

/**
 * Map Postgres / SQLAlchemy type spellings to a canonical form so equivalent
 * types don't read as drift. The sidecar compiles SQLAlchemy types with the
 * Postgres dialect (→ VARCHAR(255), INTEGER, BOOLEAN…); the live side comes
 * from information_schema (→ character varying(255), integer, boolean…). This
 * folds the known synonyms so only real differences surface.
 */
export function canonicalType(raw: string): string {
  let t = raw.trim().toLowerCase();
  // Normalize whitespace BEFORE any synonym replacement so inconsistent
  // information_schema spacing ("character  varying", "varchar (255)",
  // "numeric( 10, 2 )") doesn't read as drift.
  t = t.replace(/\s+/g, " ");
  t = t.replace(/\s*\(\s*/g, "(").replace(/\s*\)\s*/g, ")");
  t = t.replace(/\s*,\s*/g, ",");
  t = t.replace(/^character varying/, "varchar");
  t = t.replace(/^character(\b|\()/, "char$1");
  t = t.replace(/^int4$/, "integer").replace(/^int8$/, "bigint").replace(/^int2$/, "smallint");
  t = t.replace(/^bool$/, "boolean");
  t = t.replace(/^float8$/, "double precision").replace(/^float4$/, "real");
  t = t.replace(/^timestamp without time zone/, "timestamp");
  t = t.replace(/^timestamp with time zone/, "timestamptz");
  return t.replace(/\s+/g, " ").trim();
}

/**
 * Diff declared schema (models — the source of truth) against the live DB.
 * `expected` = what the models declare; `actual` = what the database has.
 */
export function diffSchemas(declared: NormalizedSchema, live: NormalizedSchema): DriftFinding[] {
  const findings: DriftFinding[] = [];
  const liveByName = new Map(live.tables.map((t) => [t.name, t]));
  const declByName = new Map(declared.tables.map((t) => [t.name, t]));

  for (const dt of declared.tables) {
    const lt = liveByName.get(dt.name);
    if (!lt) {
      findings.push({
        class: "missing_table",
        table: dt.name,
        detail: `Table "${dt.name}" is declared in models but missing in the database.`,
      });
      continue;
    }
    const liveCols = new Map(lt.columns.map((c) => [c.name, c]));
    for (const dc of dt.columns) {
      const lc = liveCols.get(dc.name);
      if (!lc) {
        findings.push({
          class: "missing_column",
          table: dt.name,
          column: dc.name,
          expected: dc.type,
          detail: `Column "${dt.name}.${dc.name}" is declared but missing in the database.`,
        });
        continue;
      }
      if (canonicalType(dc.type) !== canonicalType(lc.type)) {
        findings.push({
          class: "type_mismatch",
          table: dt.name,
          column: dc.name,
          expected: dc.type,
          actual: lc.type,
          detail: `Column "${dt.name}.${dc.name}" type differs: model ${dc.type} vs db ${lc.type}.`,
        });
      }
      if (dc.nullable !== lc.nullable) {
        findings.push({
          class: "nullability_mismatch",
          table: dt.name,
          column: dc.name,
          expected: `nullable=${dc.nullable}`,
          actual: `nullable=${lc.nullable}`,
          detail: `Column "${dt.name}.${dc.name}" nullability differs: model nullable=${dc.nullable} vs db nullable=${lc.nullable}.`,
        });
      }
    }
    for (const lc of lt.columns) {
      if (!dt.columns.some((c) => c.name === lc.name)) {
        findings.push({
          class: "extra_column",
          table: dt.name,
          column: lc.name,
          actual: lc.type,
          detail: `Column "${dt.name}.${lc.name}" exists in the database but not in the models.`,
        });
      }
    }
  }

  for (const lt of live.tables) {
    if (!declByName.has(lt.name)) {
      findings.push({
        class: "extra_table",
        table: lt.name,
        detail: `Table "${lt.name}" exists in the database but not in the models.`,
      });
    }
  }

  return findings;
}
