/**
 * The faint phone-screen backdrop at the centre of the versus scene — a barely-there, portrait
 * rounded-rectangle "question screen" standing between the two rivals, with the gold VS overlapping
 * it in front. Inside: abstract purple/grey UI blocks only (an earpiece/notch pill, one larger
 * question block, two text-line bars, three answer rows, a small dot row) — no words, letters,
 * numbers or icons — so at a glance it reads "the trivia they're duelling over", not a battle
 * arena. Deliberately low-contrast: it connects the two player sides without competing with the
 * avatars or the VS. In-flow (the parent centres it and overlays the VS); built from divs (crisp at
 * any size, re-skins per theme, cheap). Decorative → aria-hidden.
 */

/** One abstract content bar — purple or grey glass, no content. */
function Bar({ width, height, purple = false, radius = 6 }: { width: string; height: string; purple?: boolean; radius?: number }) {
  return (
    <div
      style={{
        width,
        height,
        borderRadius: radius,
        background: purple
          ? "color-mix(in srgb, var(--brand-2) 24%, transparent)"
          : "rgba(255,255,255,.11)",
        border: "1px solid rgba(255,255,255,.07)",
        flex: "none",
      }}
    />
  );
}

export function PhoneSilhouette() {
  return (
    <div
      aria-hidden
      style={{
        position: "relative",
        height: "clamp(102px, 31cqw, 140px)",
        aspectRatio: "10 / 16",
        pointerEvents: "none",
        borderRadius: "clamp(12px, 3.6cqw, 17px)",
        // Almost-transparent glass: soft grey-purple linework + a whisper of purple pooling at the
        // top — screen-like depth without glow bloom.
        background:
          "radial-gradient(95% 55% at 50% 8%, color-mix(in srgb, var(--brand) 26%, transparent) 0%, transparent 68%)," +
          " linear-gradient(180deg, rgba(200,188,232,.1) 0%, rgba(140,118,196,.07) 100%)",
        border: "1px solid color-mix(in srgb, var(--brand-2) 42%, rgba(255,255,255,.08))",
        boxShadow: "inset 0 1px 0 rgba(255,255,255,.11), inset 0 0 16px color-mix(in srgb, var(--brand) 14%, transparent)",
        padding: "7% 9%",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: "5%",
      }}
    >
      {/* Earpiece/notch pill — the one cue that says "phone", kept tiny. */}
      <Bar width="36%" height="3.2%" radius={999} />
      {/* Question block — the larger content panel near the top. */}
      <Bar width="100%" height="16%" purple radius={8} />
      {/* Text-line bars. */}
      <Bar width="82%" height="4%" radius={999} />
      <Bar width="58%" height="4%" radius={999} />
      {/* Answer rows. */}
      <Bar width="100%" height="9.5%" purple radius={7} />
      <Bar width="100%" height="9.5%" radius={7} />
      <Bar width="100%" height="9.5%" purple radius={7} />
      {/* Progress-dot row — three tiny circles, the quietest hint of a quiz stepper. */}
      <div style={{ display: "flex", gap: "8%", justifyContent: "center", width: "100%", marginTop: "auto" }}>
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            style={{
              width: "clamp(3px, 1cqw, 5px)",
              height: "clamp(3px, 1cqw, 5px)",
              borderRadius: "50%",
              background: i === 0 ? "color-mix(in srgb, var(--brand-2) 40%, transparent)" : "rgba(255,255,255,.12)",
            }}
          />
        ))}
      </div>
    </div>
  );
}
