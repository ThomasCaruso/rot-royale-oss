// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { MasteryItem } from "@/api/client";
import { MasteryCard } from "./MasteryCard";

const LABELS = {
  title: "Mastery by subject",
  mastered: "Mastered",
  growing: "Growing",
  newTag: "New",
  up: "+1",
  lv: "Lv",
};

const ITEMS: MasteryItem[] = [
  { category: "Science & Nature", level: 5, attempts: 40, mastered: true },
  { category: "History", level: 3, attempts: 18, mastered: false },
  { category: "Geography", level: 0, attempts: 1, mastered: false },
];

describe("MasteryCard", () => {
  afterEach(() => cleanup());

  it("renders a mastered row, a mid-level row, and a warming-up row", () => {
    render(<MasteryCard items={ITEMS} leveledUp={new Set()} labels={LABELS} />);
    expect(screen.getByText("Mastery by subject")).toBeTruthy();
    // Mastered (Lv 5) shows the mastered tag
    expect(screen.getByText("Mastered")).toBeTruthy();
    // Normal row shows "Lv 3"
    expect(screen.getByText("Lv 3")).toBeTruthy();
    // Warming-up (level 0) shows the "New" label (in the level slot). It appears there.
    expect(screen.getAllByText("New").length).toBeGreaterThan(0);
  });

  it("shows an up arrow for a category that just leveled up", () => {
    render(
      <MasteryCard items={ITEMS} leveledUp={new Set(["History"])} labels={LABELS} />,
    );
    // the up-arrow mark next to the name
    expect(screen.getByText("↑")).toBeTruthy();
    // and the "+1" leveled-up tag replaces the normal tag for that row
    expect(screen.getByText("+1")).toBeTruthy();
  });
});
