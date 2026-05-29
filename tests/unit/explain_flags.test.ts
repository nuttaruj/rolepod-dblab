import { describe, it, expect } from "vitest";
import { analyzePlan, type PlanNode } from "../../src/tools/db_explain.js";

describe("analyzePlan", () => {
  it("flags a filtered Seq Scan as possible_missing_index", () => {
    const root: PlanNode = {
      "Node Type": "Seq Scan",
      "Relation Name": "orders",
      "Plan Rows": 1200,
      Filter: "(status = 'paid'::text)",
    };
    const flags = analyzePlan(root);
    expect(flags).toHaveLength(1);
    expect(flags[0]?.kind).toBe("possible_missing_index");
    expect(flags[0]?.relation).toBe("orders");
    expect(flags[0]?.filter).toContain("status");
  });

  it("flags an unfiltered Seq Scan as seq_scan", () => {
    const root: PlanNode = { "Node Type": "Seq Scan", "Relation Name": "tiny", "Plan Rows": 3 };
    const flags = analyzePlan(root);
    expect(flags[0]?.kind).toBe("seq_scan");
  });

  it("does not flag an Index Scan (no concern after indexing)", () => {
    const root: PlanNode = {
      "Node Type": "Index Scan",
      "Relation Name": "orders",
      "Plan Rows": 1,
    };
    expect(analyzePlan(root)).toHaveLength(0);
  });

  it("recurses into child plans", () => {
    const root: PlanNode = {
      "Node Type": "Hash Join",
      Plans: [
        { "Node Type": "Seq Scan", "Relation Name": "a", "Plan Rows": 50, Filter: "(x > 1)" },
        { "Node Type": "Index Scan", "Relation Name": "b", "Plan Rows": 1 },
      ],
    };
    const flags = analyzePlan(root);
    expect(flags).toHaveLength(1);
    expect(flags[0]?.relation).toBe("a");
  });
});
