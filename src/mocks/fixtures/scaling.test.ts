import { it, expect } from "vitest";
import { makeDatabase } from "../lib/database";
import { scalingSchema } from "../../lib/schema";
it("keeps policy models and event snapshots consistent", () => {
  const db = makeDatabase();
  for (const p of db.policies) {
    expect(scalingSchema.safeParse(p.config).success).toBe(true);
    const r = db.resources.find((r) => r.resourceUuid === p.resourceUuid)!;
    expect(p.config.strategy_model).toBe(
      r.kind === "inference" ? "replica" : "node_pool",
    );
  }
  for (const e of db.scalingEvents) {
    expect(e.direction === "scale_out" ? e.to > e.from : e.to < e.from).toBe(
      true,
    );
    expect(e.value).toBeGreaterThan(e.threshold);
    expect(e.durationS).toBeGreaterThan(0);
  }
});
