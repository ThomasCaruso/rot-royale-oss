import { afterEach, describe, expect, it } from "vitest";
import { formatLocalTime } from "@/lib/time";

// formatLocalTime renders a stored UTC instant in the VIEWER'S local zone. To prove it genuinely
// tracks whatever zone it runs in (not just echoing one machine), we drive the same instant through
// several explicit zones by setting process.env.TZ — Node re-points Intl's default zone on change.
const ORIGINAL_TZ = process.env.TZ;

afterEach(() => {
  if (ORIGINAL_TZ === undefined) delete process.env.TZ;
  else process.env.TZ = ORIGINAL_TZ;
});

function formatIn(timeZone: string, iso: string): string {
  process.env.TZ = timeZone;
  return formatLocalTime(iso);
}

describe("formatLocalTime", () => {
  it("renders the same stored UTC instant as each zone's correct local wall-clock time", () => {
    const nightOpen = "2026-06-06T20:00:00Z"; // night window opens 16:00 ET (= 20:00 UTC in summer)
    expect(formatIn("America/New_York", nightOpen)).toBe("04:00 PM"); // EDT, UTC−4
    expect(formatIn("America/Los_Angeles", nightOpen)).toBe("01:00 PM"); // PDT, UTC−7
    expect(formatIn("Europe/London", nightOpen)).toBe("09:00 PM"); // BST, UTC+1
    expect(formatIn("UTC", nightOpen)).toBe("08:00 PM"); // UTC±0
  });

  it("tracks the zone's own DST — the same UTC instant shifts by an hour across seasons", () => {
    // Same 17:00 UTC clock time, six months apart: New York is EDT (UTC−4) in July, EST (UTC−5) in
    // January, so the local render differs by exactly one hour. A fixed offset couldn't do this.
    expect(formatIn("America/New_York", "2026-07-01T17:00:00Z")).toBe("01:00 PM"); // EDT
    expect(formatIn("America/New_York", "2026-01-01T17:00:00Z")).toBe("12:00 PM"); // EST
  });

  it("shows am/pm and never an 'ET' label", () => {
    const out = formatIn("America/Los_Angeles", "2026-06-06T20:00:00Z");
    expect(out).not.toContain("ET");
    expect(out).toMatch(/\b(AM|PM)\b/);
  });
});
