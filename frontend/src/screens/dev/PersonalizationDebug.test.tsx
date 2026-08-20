// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { api, type TasteProfile } from "@/api/client";
import { isPersonalizationDebugEnabled } from "@/lib/personalizationFlags";
import { PersonalizationDebug } from "./PersonalizationDebug";

const profile: TasteProfile = {
  user_id: "u-1",
  category_affinity: { Sports: 0.4 },
  subcategory_affinity: {},
  topic_affinity: { "nba history": 0.3 },
  difficulty_preference: 0.55,
  humor_preference: 0.5,
  brainrot_tolerance: 0.5,
  novelty_preference: 0.5,
  educational_preference: 0.5,
  disliked_topics: ["opera"],
  weak_but_interesting_topics: ["quantum physics"],
  last_seen_topic_tags: [],
  last_seen_categories: [],
  interaction_count: 12,
  confidence_score: 0.24,
};

describe("PersonalizationDebug — hidden unless explicitly enabled", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("renders nothing when the debug flag is unset (production default)", () => {
    const spy = vi.spyOn(api, "getTasteProfile").mockResolvedValue(profile);
    expect(isPersonalizationDebugEnabled()).toBe(false);
    const { container } = render(<PersonalizationDebug />);
    expect(container.innerHTML).toBe("");
    expect(spy).not.toHaveBeenCalled(); // no fetch either — fully inert
  });

  it("renders the profile when VITE_PERSONALIZATION_DEBUG=true", async () => {
    vi.stubEnv("VITE_PERSONALIZATION_DEBUG", "true");
    vi.spyOn(api, "getTasteProfile").mockResolvedValue(profile);
    render(<PersonalizationDebug />);
    expect(await screen.findByTestId("personalization-debug")).toBeTruthy();
    expect(screen.getByText(/quantum physics/)).toBeTruthy();
    expect(screen.getByText(/opera/)).toBeTruthy();
  });
});
