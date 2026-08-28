// @vitest-environment jsdom
/**
 * Round modules must render the ACTIVE locale's copy, never a hardcoded English literal.
 *
 * This is a regression test for a bug that shipped and went unnoticed for a long time. The module
 * contract used to say "modules carry no i18n", so every module label was written as an English
 * string literal — "Spot the change", "Estimate", "Watch closely", "First image", "Your turn",
 * "Actual", "You found it." — and Spanish, French and Turkish players were shown those English
 * words on every single round they played. Nothing caught it: the dictionaries were complete and
 * type-checked, so the compile-time guarantee in CLAUDE.md §7 was intact and simply never applied
 * to these strings, because they were not in a dictionary at all.
 *
 * The literals are the thing under test, so they are written out here on purpose. If a module goes
 * back to hardcoding, this fails; if a translation is merely edited, it does not.
 */

import { render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/api/client", () => ({
  api: { cogChangeSubmit: vi.fn(), cogEstimateGuess: vi.fn(), cogVideoAnswer: vi.fn() },
}));
vi.mock("@/lib/sfx", () => ({ haptic: vi.fn() }));
vi.mock("@/lib/haptics", () => ({ feedback: vi.fn() }));

import { en } from "@/i18n/en";
import { es } from "@/i18n/es";
import { useI18n } from "@/store/i18n";
import { ChangeRound } from "@/modules/changeDetection/ChangeRound";
import { EstimateReveal } from "@/modules/estimate/EstimateReveal";
import { EstimateRound } from "@/modules/estimate/EstimateRound";
import { MemoryFlashRound } from "@/modules/memoryFlash/MemoryFlashRound";
import { VideoRound } from "@/modules/video/VideoRound";

/** Every English literal that used to be baked into a module's JSX. None may survive in es. */
const FORMERLY_HARDCODED = [
  "Spot the change",
  "Tap where it changes",
  "First image",
  "Second image",
  "Estimate",
  "Range",
  "Actual",
  "Your guess",
  "Video round",
  "Watch closely",
  "Watch the clip",
  "Your turn",
  "Memorize the pattern",
  "Now repeat it",
];

function expectNoEnglish(html: string) {
  for (const literal of FORMERLY_HARDCODED) {
    expect(html, `"${literal}" leaked into a non-English render`).not.toContain(literal);
  }
}

describe("round modules render the active locale", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Set the dictionary directly. `setLocale` code-splits the dict behind a dynamic import, which
    // would make this async for no benefit — the property under test is "the module reads the
    // store", not "the store can load a chunk".
    useI18n.setState({ locale: "es", dict: es, ready: true });
  });
  afterEach(() => {
    vi.useRealTimers();
    useI18n.setState({ locale: "en", dict: en, ready: true });
  });

  it("ChangeRound", () => {
    const { container } = render(
      <ChangeRound
        spec={{
          cognition_instance_id: "i1",
          base_url: "/b.jpg",
          altered_url: "/a.jpg",
          width: 1122,
          height: 1402,
          flicker_base_ms: 5000,
          flicker_altered_ms: 7000,
          flicker_blank_ms: 80,
          flicker_label_ms: 1300,
          time_limit_ms: 30000,
        }}
        onComplete={() => {}}
      />,
    );
    expect(container.innerHTML).toContain(es.rounds.spotTheChange);
    expectNoEnglish(container.innerHTML);
  });

  it("EstimateRound", () => {
    const { container } = render(
      <EstimateRound
        spec={{
          cognition_instance_id: "i2",
          prompt: "¿Cuántos?",
          unit: null,
          difficulty: "medium",
          slider_min: 1,
          slider_max: 1000,
          max_guesses: 3,
        }}
        onComplete={() => {}}
      />,
    );
    expect(container.innerHTML).toContain(es.rounds.estimate);
    expectNoEnglish(container.innerHTML);
  });

  it("EstimateReveal", () => {
    const { container } = render(
      <EstimateReveal
        spec={{ unit: null, slider_min: 1, slider_max: 1000 }}
        answer={{ answer: 1000 }}
        result={{ final_guess: 550 }}
      />,
    );
    expect(container.innerHTML).toContain(es.rounds.actual);
    expectNoEnglish(container.innerHTML);
  });

  it("VideoRound", () => {
    const { container } = render(
      <VideoRound
        spec={{
          cognition_instance_id: "i3",
          base_url: "/v/b.mp4",
          altered_url: "/v/a.mp4",
          width: 720,
          height: 1280,
          duration_ms: 5040,
          question_time_limit_ms: 5000,
          questions: [
            { prompt: "p1", options: ["a", "b", "c", "d"] },
            { prompt: "p2", options: ["a", "b", "c", "d"] },
          ],
          change_question: { prompt: "p3", options: ["a", "b", "c", "d"] },
        }}
        onComplete={() => {}}
      />,
    );
    expect(container.innerHTML).toContain(es.rounds.watchClosely);
    expectNoEnglish(container.innerHTML);
  });

  it("MemoryFlashRound", () => {
    const { container } = render(
      <MemoryFlashRound
        spec={{ sequence: [0, 1, 2], tiles: 4, category: "Memoria", icon: "🧠", time_limit_ms: 10000 }}
        onComplete={() => {}}
      />,
    );
    expectNoEnglish(container.innerHTML);
  });
});
