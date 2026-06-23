import { describe, it, expect } from "vitest";
import { pickHost } from "./hostElection";

describe("pickHost", () => {
  it("returns null for an empty room", () => {
    expect(pickHost([])).toBeNull();
  });
  it("picks the lexicographically smallest uid deterministically", () => {
    expect(pickHost(["zeta", "alpha", "mid"])).toBe("alpha");
    expect(pickHost(["mid", "alpha", "zeta"])).toBe("alpha");
  });
  it("is stable when the host is unchanged across calls", () => {
    const a = pickHost(["u2", "u1", "u3"]);
    const b = pickHost(["u3", "u2", "u1"]);
    expect(a).toBe(b);
  });
});
