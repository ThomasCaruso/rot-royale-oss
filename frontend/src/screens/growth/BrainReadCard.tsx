/**
 * The Read — the AI-analysis HERO of "Your Growth". Where the AI reads the player instead of just
 * charting them: identity (rot_type) + one real insight (strength / weak spot) + a light forward
 * nudge, composed from the latest check by `composeBrainRead`. Visually special (a soft brand glow
 * behind the header chip, a brand-tinted top accent) but calm — only the key nouns carry green, the
 * rest stays ink. Empty state is an inviting prompt, never fake data.
 */

import type React from "react";
import { Display } from "@/ui/Display";
import { SparkIcon } from "@/ui/icons";
import type { BrainBoostSummary } from "@/api/client";
import { composeBrainRead, type BrainRead } from "./brainRead";
import { CardLabel } from "./ui";
import { growthCardStyle } from "./styles";

const EMPH: React.CSSProperties = { color: "var(--lime)", fontWeight: 700 };

/** Punchy one-word names for the read's voice ("Science" reads sharper than "Science & Nature", and
 * avoids an "& Nature and History" adjacency when two strengths are joined). Read-only — the stat
 * bars keep the full names via the shared `shortCategory`. Unmapped categories pass through. */
const READ_NAME: Record<string, string> = {
  "Science & Nature": "Science",
  "Arts & Literature": "Arts",
  "Money & Business": "Money",
  "Pop Culture & Entertainment": "Pop Culture",
};
const readName = (c: string): string => READ_NAME[c] ?? c;

export interface BrainReadLabels {
  eyebrow: string;
  emptyHeadline: string;
  emptyBody: string;
  strongElite: string;
  strongEliteSolo: string;
  strongSolid: string;
  strongRookie: string;
  weakSharp: string;
  weakSoft: string;
  fwdFirst: string;
  fwdRising: string;
  fwdElite: string;
  fwdSolid: string;
}

/** Emphasized interpolation: split a template on its placeholder tokens and drop a green <span> in
 * for each named noun. Mirrors AIInsightCard's "only key nouns carry color" house style. Tokens are
 * `{a}` (top strength), `{b}` (second), `{w}` (weak spot), `{r}` (rising). Order-independent. */
function fillEmph(
  template: string,
  values: Partial<Record<"a" | "b" | "w" | "r", string>>,
): React.ReactNode {
  const parts = template.split(/(\{[abwr]\})/g);
  return parts.map((part, i) => {
    const m = /^\{([abwr])\}$/.exec(part);
    if (m) {
      const val = values[m[1] as "a" | "b" | "w" | "r"];
      if (val !== undefined) {
        return (
          <span key={i} style={EMPH}>
            {val}
          </span>
        );
      }
      return null;
    }
    return part;
  });
}

/** The composed body: strength line + optional weak-spot line + forward line (2–3 sentences). */
function buildBody(read: BrainRead, labels: BrainReadLabels): React.ReactNode[] {
  const lines: React.ReactNode[] = [];
  const a = read.topStrength ? readName(read.topStrength) : undefined;
  const b = read.secondStrength ? readName(read.secondStrength) : undefined;
  const w =
    read.weakSpot !== null
      ? read.weakIsTopic
        ? read.weakSpot
        : readName(read.weakSpot)
      : undefined;
  const r = read.risingCategory ? readName(read.risingCategory) : undefined;

  // Strength line.
  let strengthTpl: string;
  if (read.band === "elite") {
    strengthTpl = read.secondStrength ? labels.strongElite : labels.strongEliteSolo;
  } else if (read.band === "solid") {
    strengthTpl = labels.strongSolid;
  } else {
    strengthTpl = labels.strongRookie;
  }
  lines.push(fillEmph(strengthTpl, { a, b }));

  // Weak-spot line (only when a distinct weak spot exists).
  if (read.weakSpot !== null) {
    const weakTpl = read.band === "rookie" ? labels.weakSoft : labels.weakSharp;
    lines.push(fillEmph(weakTpl, { w }));
  }

  // Forward line: firstCheck > rising > band generic.
  let fwdTpl: string;
  if (read.firstCheck) {
    fwdTpl = labels.fwdFirst;
  } else if (read.risingCategory) {
    fwdTpl = labels.fwdRising;
  } else if (read.band === "elite") {
    fwdTpl = labels.fwdElite;
  } else {
    fwdTpl = labels.fwdSolid;
  }
  lines.push(fillEmph(fwdTpl, { r }));

  return lines;
}

function HeaderChip({ eyebrow }: { eyebrow: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, position: "relative", zIndex: 1 }}>
      <span
        aria-hidden
        style={{
          width: 42,
          height: 42,
          borderRadius: 999,
          flex: "none",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "color-mix(in srgb, var(--brand) 12%, transparent)",
          border: "1px solid color-mix(in srgb, var(--brand) 22%, transparent)",
          color: "var(--brand)",
        }}
      >
        <SparkIcon size={19} />
      </span>
      <CardLabel>{eyebrow}</CardLabel>
    </div>
  );
}

export function BrainReadCard({
  summary,
  labels,
}: {
  summary: BrainBoostSummary | null;
  labels: BrainReadLabels;
}) {
  const read = composeBrainRead(summary);

  // Hero treatment: brand-tinted top accent + a static, GPU-cheap radial glow behind the header
  // chip. No essential info lives in motion, so this is reduced-motion-safe without any animation.
  const heroStyle: React.CSSProperties = {
    ...growthCardStyle,
    position: "relative",
    overflow: "hidden",
    borderTop: "2px solid color-mix(in srgb, var(--brand) 40%, var(--line))",
    background:
      "radial-gradient(120% 90% at 12% 0%, color-mix(in srgb, var(--brand) 9%, transparent), transparent 60%), var(--panel)",
  };

  if (read.isEmpty) {
    return (
      <section style={heroStyle}>
        <HeaderChip eyebrow={labels.eyebrow} />
        <Display style={{ fontSize: 29, marginTop: 16, position: "relative", zIndex: 1 }}>
          {labels.emptyHeadline}
        </Display>
        <p
          style={{
            margin: "10px 0 0",
            fontSize: 15,
            lineHeight: 1.6,
            color: "var(--muted)",
            position: "relative",
            zIndex: 1,
          }}
        >
          {labels.emptyBody}
        </p>
      </section>
    );
  }

  const lines = buildBody(read, labels);

  return (
    <section style={heroStyle}>
      <HeaderChip eyebrow={labels.eyebrow} />
      <Display style={{ fontSize: 29, marginTop: 16, position: "relative", zIndex: 1 }}>
        {read.headline}
      </Display>
      <p
        style={{
          margin: "12px 0 0",
          fontSize: 15.5,
          lineHeight: 1.6,
          color: "var(--text)",
          position: "relative",
          zIndex: 1,
        }}
      >
        {lines.map((line, i) => (
          <span key={i}>
            {line}
            {i < lines.length - 1 ? " " : null}
          </span>
        ))}
      </p>
    </section>
  );
}
