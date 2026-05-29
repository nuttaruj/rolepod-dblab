import { describe, it, expect } from "vitest";
import { diffSchemas, canonicalType } from "../../src/drift/differ.js";
import type { NormalizedSchema } from "../../src/drift/types.js";

describe("canonicalType", () => {
  it("folds Postgres / SQLAlchemy synonyms", () => {
    expect(canonicalType("character varying(255)")).toBe(canonicalType("VARCHAR(255)"));
    expect(canonicalType("INTEGER")).toBe("integer");
    expect(canonicalType("int4")).toBe("integer");
    expect(canonicalType("BOOLEAN")).toBe("boolean");
    expect(canonicalType("numeric(10, 2)")).toBe("numeric(10,2)");
  });
  it("tolerates inconsistent whitespace from information_schema", () => {
    expect(canonicalType("character  varying(255)")).toBe("varchar(255)");
    expect(canonicalType("character varying (255)")).toBe("varchar(255)");
    expect(canonicalType("numeric( 10 , 2 )")).toBe("numeric(10,2)");
  });
  it("keeps genuinely different types distinct", () => {
    expect(canonicalType("integer")).not.toBe(canonicalType("bigint"));
  });
});

describe("diffSchemas", () => {
  const declared: NormalizedSchema = {
    tables: [
      {
        name: "users",
        columns: [
          { name: "id", type: "INTEGER", nullable: false },
          { name: "email", type: "VARCHAR(255)", nullable: false },
          { name: "full_name", type: "VARCHAR(100)", nullable: false },
        ],
      },
    ],
  };

  it("detects nullability + missing_column + type_mismatch", () => {
    const live: NormalizedSchema = {
      tables: [
        {
          name: "users",
          columns: [
            { name: "id", type: "bigint", nullable: false }, // type_mismatch (INTEGER vs bigint)
            { name: "email", type: "character varying(255)", nullable: true }, // nullability_mismatch
            // full_name missing → missing_column
          ],
        },
      ],
    };
    const findings = diffSchemas(declared, live);
    const classes = findings.map((f) => f.class);
    expect(classes).toContain("type_mismatch");
    expect(classes).toContain("nullability_mismatch");
    expect(classes).toContain("missing_column");
    // email is only a nullability diff, NOT a type diff (varchar synonym folded)
    expect(findings.find((f) => f.column === "email")?.class).toBe("nullability_mismatch");
  });

  it("reports no drift when schemas match (synonyms folded)", () => {
    const live: NormalizedSchema = {
      tables: [
        {
          name: "users",
          columns: [
            { name: "id", type: "integer", nullable: false },
            { name: "email", type: "character varying(255)", nullable: false },
            { name: "full_name", type: "character varying(100)", nullable: false },
          ],
        },
      ],
    };
    expect(diffSchemas(declared, live)).toHaveLength(0);
  });

  it("flags a table missing in the database", () => {
    const findings = diffSchemas(declared, { tables: [] });
    expect(findings[0]?.class).toBe("missing_table");
  });
});
