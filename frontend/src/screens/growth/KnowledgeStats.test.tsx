// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { BrainBoostSummary } from "@/api/client";
import { KnowledgeStats } from "./KnowledgeStats";

const LABELS = { eyebrow: "Knowledge Profile", empty: "Play your first check to build your Brain Profile." };

function summaryWith(cats: { category: string; score: number; total?: number }[]): BrainBoostSummary {
  return {
    entry_id: "e", mode: "starter", submitted_at: "", total: 8, correct: 6, accuracy: 0.75, brain_score: 495,
    rot_type: "x", strengths: [], weaknesses: [],
    categories: cats.map((c) => ({ category: c.category, correct: 1, total: c.total ?? 2, accuracy: 0.5, score: c.score })),
    weak_spot_topic: null, movements: {}, first_check: false,
  };
}

describe("KnowledgeStats", () => {
  afterEach(() => cleanup());

  it("always renders the full subject roster — measured rows + honest placeholder rows", () => {
    // Only Geography measured: it reads with its score, every other subject holds its place neutrally.
    render(<KnowledgeStats summary={summaryWith([{ category: "Geography", score: 62 }])} labels={LABELS} />);
    expect(screen.getByRole("img", { name: /Geography, score 62/ })).toBeTruthy();
    expect(screen.getByText("62")).toBeTruthy();
    expect(screen.getByRole("img", { name: /Science & Nature, not yet measured/ })).toBeTruthy();
    expect(screen.getByRole("img", { name: /Money & Business, not yet measured/ })).toBeTruthy();
    // the full structure is always present (7 subjects), never collapsed to one row
    expect(screen.getAllByRole("img").length).toBe(7);
  });

  it("sorts measured subjects strongest-first with shortened names", () => {
    render(
      <KnowledgeStats
        summary={summaryWith([
          { category: "Pop Culture & Entertainment", score: 30 },
          { category: "Science & Nature", score: 96 },
        ])}
        labels={LABELS}
      />,
    );
    expect(screen.getByText("96")).toBeTruthy();
    expect(screen.getByText("Pop Culture")).toBeTruthy();
    const order = screen.getAllByRole("img").map((r) => r.getAttribute("aria-label"));
    expect(order[0]).toMatch(/Science & Nature, score 96/);
    expect(order[1]).toMatch(/Pop Culture & Entertainment, score 30/);
  });

  it("shows the empty invite (and the full placeholder roster) when nothing is measured", () => {
    render(<KnowledgeStats summary={null} labels={LABELS} />);
    expect(screen.getByText(/Play your first check/)).toBeTruthy();
    expect(screen.getAllByRole("img").length).toBe(7);
    expect(screen.getByRole("img", { name: /Geography, not yet measured/ })).toBeTruthy();
  });
});
