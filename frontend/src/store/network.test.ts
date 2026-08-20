import { vi } from "vitest";
vi.mock("@capacitor/network", () => ({
  Network: {
    addListener: async () => ({ remove() {} }),
    getStatus: async () => ({ connected: true }),
  },
}));

import { describe, it, expect } from "vitest";
import { useNetwork, setOnline } from "./network";

describe("useNetwork", () => {
  it("defaults to online and reflects setOnline", () => {
    setOnline(true);
    expect(useNetwork.getState().online).toBe(true);
    setOnline(false);
    expect(useNetwork.getState().online).toBe(false);
  });
});
