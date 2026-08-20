import { describe, expect, it } from "vitest";

import { resolveFirstRunStep } from "./firstRun";

describe("resolveFirstRunStep — the no-signup-wall routing rule", () => {
  it("a brand-new anonymous visitor gets the Brain Boost intro, never a login wall", () => {
    expect(resolveFirstRunStep("anonymous", false, false)).toBe("intro");
    expect(resolveFirstRunStep("anonymous", false, true)).toBe("intro");
  });

  it("a guest who hasn't finished the Starter Check resumes the check flow", () => {
    expect(resolveFirstRunStep("authenticated", true, false)).toBe("check");
  });

  it("a guest past first-run gets the normal app (with the save banner on Home)", () => {
    expect(resolveFirstRunStep("authenticated", true, true)).toBe("none");
  });

  it("an existing registered account bypasses first-run entirely", () => {
    expect(resolveFirstRunStep("authenticated", false, false)).toBe("none");
    expect(resolveFirstRunStep("authenticated", false, true)).toBe("none");
  });

  it("bootstrapping renders nothing first-run related (the shell shows the splash)", () => {
    expect(resolveFirstRunStep("bootstrapping", false, false)).toBe("none");
  });
});
