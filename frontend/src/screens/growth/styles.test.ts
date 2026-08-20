import { describe, expect, it } from "vitest";
import { tier } from "./styles";

describe("tier", () => {
  it("buckets scores into the four ranks at the right thresholds", () => {
    expect(tier(100).name).toBe("Elite");
    expect(tier(85).name).toBe("Elite");
    expect(tier(84).name).toBe("Master");
    expect(tier(70).name).toBe("Master");
    expect(tier(69).name).toBe("Adept");
    expect(tier(50).name).toBe("Adept");
    expect(tier(49).name).toBe("Novice");
    expect(tier(0).name).toBe("Novice");
  });

  it("gives Elite the gold token and Novice the faint token", () => {
    expect(tier(90).color).toBe("var(--amber)");
    expect(tier(10).color).toBe("var(--faint)");
  });
});
