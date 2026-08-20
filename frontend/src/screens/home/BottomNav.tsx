import { useT } from "@/i18n/useT";
import type { PlayTarget } from "@/lib/playModes";
import { FitText } from "@/ui/FitText";
import { useArtStyle, useThemeArt } from "@/theme/useArtStyle";

/**
 * Floating mobile-game nav. Real destinations — Home, Campaign, Play, Leaderboard, Vault — are
 * interactive (no fake affordances; same trust rule as data). Every slot is labelled, with the
 * centre Play button elevated. `active` marks which screen is showing it
 * (home/campaign/leaderboard/vault) so that tab is the non-interactive highlighted item and the rest
 * become navigation buttons; `none` highlights nothing (every slot navigates). The profile menu stays
 * behind the header avatar (not a nav slot).
 *
 * The centre Play button is state-aware: `playTarget` says where `onPlay` routes — "royale" while
 * today's Daily Royale attempt is still available (the main event; the disc pulses), "quick" once
 * the score is locked (Quick Play, the no-stakes 8-question mixed trivia replay loop). The label
 * stays "Play" either way; only the destination changes. `onPlay` is only ever absent for the brief
 * loading beat before the contest state resolves.
 */
export function BottomNav({
  active = "home",
  onPlay,
  playTarget = "quick",
  onHome,
  onCampaign,
  onLeaderboard,
  onVault,
}: {
  active?: "home" | "campaign" | "leaderboard" | "vault" | "none";
  onPlay?: () => void;
  playTarget?: PlayTarget;
  onHome?: () => void;
  onCampaign?: () => void;
  onLeaderboard?: () => void;
  onVault?: () => void;
}) {
  const t = useT();
  return (
    <nav
      aria-label={t.home.navPrimary}
      style={{
        position: "fixed",
        left: 0,
        right: 0,
        bottom: "calc(10px + env(safe-area-inset-bottom))",
        zIndex: 30,
        display: "flex",
        justifyContent: "center",
        pointerEvents: "none",
        padding: "0 12px",
      }}
    >
      {/* rr-navbar: the mono ("Blank") skin restyles the bar to a slim white hairline via CSS. */}
      <div
        className="rr-navbar"
        style={{
          position: "relative",
          pointerEvents: "auto",
          width: "100%",
          maxWidth: 406,
          height: 66,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-around",
          padding: "0 10px",
          borderRadius: 30,
          background:
            "linear-gradient(180deg, color-mix(in srgb, var(--brand) 26%, rgba(16,9,34,.86)), color-mix(in srgb, var(--panel) 88%, rgba(8,4,20,.9)))",
          border: "1px solid color-mix(in srgb, var(--brand-2) 40%, transparent)",
          boxShadow:
            "0 16px 38px rgba(0,0,0,.55), inset 0 2px 0 rgba(255,255,255,.12), inset 0 -14px 26px rgba(0,0,0,.4)",
          backdropFilter: "blur(14px)",
          WebkitBackdropFilter: "blur(14px)",
        }}
      >
        {/* Bright top-edge highlight line — reads as a lit HUD bar (hidden by the mono skin). */}
        <span
          aria-hidden
          className="rr-navbar-edge"
          style={{
            position: "absolute",
            top: 0,
            left: "14%",
            right: "14%",
            height: 2,
            borderRadius: 999,
            background: "linear-gradient(90deg, transparent, color-mix(in srgb, var(--brand-2) 75%, white) 30%, color-mix(in srgb, var(--amber) 60%, white) 50%, color-mix(in srgb, var(--brand-2) 75%, white) 70%, transparent)",
            opacity: 0.7,
            pointerEvents: "none",
          }}
        />
        {active === "home" ? (
          <ActiveItem icon={<HomeGlyph />} label={t.nav.home} />
        ) : (
          <IconButton icon={<HomeGlyph />} label={t.nav.home} onClick={onHome ?? (() => {})} />
        )}
        {active === "campaign" ? (
          <ActiveItem icon={<CampaignGlyph />} label={t.nav.campaign} />
        ) : (
          <IconButton icon={<CampaignGlyph />} label={t.nav.campaign} onClick={onCampaign ?? (() => {})} />
        )}
        <PlayButton onPlay={onPlay} playTarget={playTarget} />
        {active === "leaderboard" ? (
          <ActiveItem icon={<TrophyGlyph />} label={t.nav.leaderboard} />
        ) : (
          <IconButton icon={<TrophyGlyph />} label={t.nav.leaderboard} onClick={onLeaderboard ?? (() => {})} />
        )}
        {active === "vault" ? (
          <ActiveItem icon={<VaultGlyph />} label={t.nav.vault} />
        ) : (
          <IconButton icon={<VaultGlyph />} label={t.nav.vault} onClick={onVault ?? (() => {})} />
        )}
      </div>
    </nav>
  );
}

function ActiveItem({ icon, label }: { icon: React.ReactNode; label: string }) {
  const mono = useArtStyle() === "mono";
  const art = useThemeArt();

  // Premium (Starter system): the active tab is a soft lavender-filled rounded square in the
  // brand colour, with its label visible underneath — the reference's selected state.
  if (mono && art) {
    return (
      <button
        type="button"
        aria-label={label}
        aria-current="page"
        style={{ ...itemBase, cursor: "default", gap: 3 }}
      >
        <span
          style={{
            display: "grid",
            placeItems: "center",
            width: 34,
            height: 30,
            borderRadius: 10,
            background: "color-mix(in srgb, var(--brand) 10%, var(--panel2))",
            border: "1px solid color-mix(in srgb, var(--brand) 16%, var(--line))",
            color: "var(--brand)",
          }}
        >
          {icon}
        </span>
        {/* The filled brand-tinted container is itself the "current destination" marker — the label
            just names it. No separate dot: the selected slot already reads as selected on its own. */}
        <NavLabel label={label} color="var(--brand)" />
      </button>
    );
  }

  // Mono ("Blank"): the active tab is a sleek charcoal OUTLINE — a rounded square, no colour fill.
  if (mono) {
    return (
      <button
        type="button"
        aria-label={label}
        aria-current="page"
        style={{ ...itemBase, cursor: "default" }}
      >
        <span
          style={{
            display: "grid",
            placeItems: "center",
            width: 42,
            height: 42,
            borderRadius: 13,
            background: "transparent",
            border: "1.5px solid var(--text)",
            color: "var(--text)",
          }}
        >
          {icon}
        </span>
      </button>
    );
  }

  return (
    <button
      type="button"
      aria-label={label}
      aria-current="page"
      style={{ ...itemBase, color: "var(--amber)", cursor: "default", position: "relative" }}
    >
      {/* Glowing gold pill behind the active icon. */}
      <span
        aria-hidden
        style={{
          position: "absolute",
          width: 52,
          height: 40,
          borderRadius: 999,
          background: "radial-gradient(circle, color-mix(in srgb, var(--amber) 42%, transparent), transparent 70%)",
          boxShadow: "0 0 22px color-mix(in srgb, var(--amber) 55%, transparent), inset 0 0 0 1px color-mix(in srgb, var(--amber) 30%, transparent)",
          pointerEvents: "none",
        }}
      />
      <span
        aria-hidden
        style={{ display: "flex", position: "relative", filter: "drop-shadow(0 0 9px color-mix(in srgb, var(--amber) 70%, transparent))" }}
      >
        {icon}
      </span>
    </button>
  );
}

function IconButton({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) {
  // Premium (Starter system): every slot shows its label under the icon, per the reference.
  const mono = useArtStyle() === "mono";
  const art = useThemeArt();
  const premium = mono && art != null;
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      onPointerDown={(e) => (e.currentTarget.style.transform = "scale(.9)")}
      onPointerUp={(e) => (e.currentTarget.style.transform = "scale(1)")}
      onPointerLeave={(e) => (e.currentTarget.style.transform = "scale(1)")}
      style={{ ...itemBase, color: "var(--muted)", cursor: "pointer", transition: "transform 140ms ease", gap: premium ? 4 : 0 }}
    >
      <span aria-hidden style={{ display: "flex" }}>
        {icon}
      </span>
      {premium && <NavLabel label={label} />}
    </button>
  );
}

/** Centre Play button — elevated gold disc with a play triangle. Routes to the Daily Royale while
 * the attempt is available (pulsing — the main event), else to Quick Play (the fun replay loop).
 * The mono ("Blank") skins reject the arcade physics entirely: a small outlined circle, inline
 * with the other items — no lift, no halo, no faked 3D edge. */
function PlayButton({ onPlay, playTarget }: { onPlay?: () => void; playTarget: PlayTarget }) {
  const t = useT();
  const mono = useArtStyle() === "mono";
  const art = useThemeArt();
  const enabled = Boolean(onPlay);
  const isRoyale = playTarget === "royale";

  // Premium (Starter system): the centre Play is a HOLLOW, see-through disc — just a theme-coloured
  // outline ring with the play glyph inside. No fill: the dock bar shows straight through it, so it
  // reads as an outlined action, not a solid button. The ring + glyph take the theme's brand colour.
  if (mono && art) {
    const ring = enabled ? "var(--brand)" : "var(--line)";
    const glyph = enabled ? "var(--brand)" : "var(--faint)";
    return (
      <div style={{ ...itemBase, gap: 3 }}>
        <button
          type="button"
          aria-label={enabled ? (isRoyale ? t.nav.playOpen : t.nav.playQuick) : t.nav.noGame}
          disabled={!enabled}
          onClick={onPlay}
          onPointerDown={(e) => enabled && (e.currentTarget.style.transform = "translateY(-7px) scale(.95)")}
          onPointerUp={(e) => enabled && (e.currentTarget.style.transform = "translateY(-7px)")}
          onPointerLeave={(e) => enabled && (e.currentTarget.style.transform = "translateY(-7px)")}
          style={{
            width: 46,
            height: 46,
            borderRadius: "50%",
            display: "grid",
            placeItems: "center",
            transform: "translateY(-7px)",
            // Fully transparent — you can see the bar through it; only the ring and glyph are drawn.
            background: "transparent",
            border: `2px solid ${ring}`,
            cursor: enabled ? "pointer" : "default",
            transition: "transform 140ms ease",
          }}
        >
          <svg aria-hidden viewBox="0 0 100 100" style={{ width: 17, height: 17, marginLeft: 2 }}>
            <polygon points="26,16 26,84 84,50" fill={glyph} />
          </svg>
        </button>
        <NavLabel label={t.nav.play} color={enabled ? "var(--brand)" : "var(--faint)"} style={{ marginTop: -4 }} />
      </div>
    );
  }

  if (mono) {
    // The mono Play is the page's one accent: a lavender ring with a faint lavender fill and a
    // charcoal play glyph; the label goes lavender too. Disabled falls back to a quiet hairline.
    const ring = enabled ? "var(--brand)" : "var(--faint)";
    const glyph = enabled ? "var(--text)" : "var(--faint)";
    return (
      <div style={itemBase}>
        <button
          type="button"
          aria-label={enabled ? (isRoyale ? t.nav.playOpen : t.nav.playQuick) : t.nav.noGame}
          disabled={!enabled}
          onClick={onPlay}
          onPointerDown={(e) => enabled && (e.currentTarget.style.transform = "scale(.94)")}
          onPointerUp={(e) => enabled && (e.currentTarget.style.transform = "scale(1)")}
          onPointerLeave={(e) => enabled && (e.currentTarget.style.transform = "scale(1)")}
          style={{
            width: 44,
            height: 44,
            borderRadius: "50%",
            display: "grid",
            placeItems: "center",
            background: enabled ? "color-mix(in srgb, var(--brand) 12%, transparent)" : "transparent",
            border: `1.5px solid ${ring}`,
            cursor: enabled ? "pointer" : "default",
            transition: "transform 140ms ease",
          }}
        >
          <svg aria-hidden viewBox="0 0 100 100" style={{ width: 15, height: 15, marginLeft: 2 }}>
            <polygon points="26,16 26,84 84,50" fill={glyph} />
          </svg>
        </button>
      </div>
    );
  }

  return (
    <div style={{ ...itemBase, position: "relative", transform: "translateY(-14px)" }}>
      {enabled && isRoyale && (
        <span
          aria-hidden
          style={{
            position: "absolute",
            top: -10,
            left: "50%",
            width: 96,
            height: 96,
            transform: "translateX(-50%)",
            borderRadius: "50%",
            background: "radial-gradient(circle, color-mix(in srgb, var(--amber) 42%, transparent), transparent 64%)",
            filter: "blur(3px)",
            pointerEvents: "none",
          }}
        />
      )}
      <button
        type="button"
        aria-label={enabled ? (isRoyale ? t.nav.playOpen : t.nav.playQuick) : t.nav.noGame}
        disabled={!enabled}
        onClick={onPlay}
        onPointerDown={(e) => enabled && (e.currentTarget.style.transform = "scale(.96)")}
        onPointerUp={(e) => enabled && (e.currentTarget.style.transform = "scale(1)")}
        onPointerLeave={(e) => enabled && (e.currentTarget.style.transform = "scale(1)")}
        style={{
          width: 78,
          height: 78,
          borderRadius: "50%",
          display: "grid",
          placeItems: "center",
          border: "3px solid color-mix(in srgb, var(--brand) 30%, #0c0720)",
          cursor: enabled ? "pointer" : "default",
          background: enabled
            ? "linear-gradient(180deg, color-mix(in srgb, var(--amber) 84%, white) 0%, var(--amber) 46%, color-mix(in srgb, var(--amber) 78%, #7a3d00) 100%)"
            : "linear-gradient(180deg, var(--panel2), var(--panel))",
          boxShadow: enabled
            ? "0 6px 0 color-mix(in srgb, var(--amber) 55%, #5a3700), 0 14px 28px color-mix(in srgb, var(--amber) 55%, transparent), inset 0 2px 0 rgba(255,255,255,.8), inset 0 -4px 8px rgba(140,84,0,.4)"
            : "0 8px 18px rgba(0,0,0,.4), inset 0 1px 0 rgba(255,255,255,.06)",
          opacity: enabled ? 1 : 0.85,
          transition: "transform 140ms ease",
          // While today's Daily Royale attempt is available, the disc breathes gold — the main event
          // is the obvious next action. Quick Play stays a confident static gold.
          animation: enabled && isRoyale ? "rr-glow-pulse 2.6s ease-in-out infinite" : undefined,
        }}
      >
        <svg aria-hidden viewBox="0 0 100 100" style={{ width: 32, height: 32, marginLeft: 3, filter: "drop-shadow(0 1px 1px rgba(120,70,0,.5))" }}>
          <polygon points="26,16 26,84 84,50" fill={enabled ? "var(--btnText)" : "var(--faint)"} />
        </svg>
      </button>
    </div>
  );
}

/* ---- Refined minimal line icons — thin stroke, no fill, rounded joins (nav only) ---- */
function NavGlyph({ children }: { children: React.ReactNode }) {
  return (
    <svg
      width={25}
      height={25}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      style={{ display: "block" }}
    >
      {children}
    </svg>
  );
}

/** House — roofline, walls, a slim doorway. */
function HomeGlyph() {
  return (
    <NavGlyph>
      <path d="M4 11.2 L12 4.8 L20 11.2" />
      <path d="M5.8 9.8 V19.4 H18.2 V9.8" />
      <path d="M10 19.4 V14.6 H14 V19.4" />
    </NavGlyph>
  );
}

/** Waving flag on a pole — the campaign's quest / milestone marker. */
function CampaignGlyph() {
  return (
    <NavGlyph>
      <path d="M6 3.4 V20.6" />
      <path d="M6 4.6 C9 3.3 11.8 6 15 4.9 C16.6 4.35 17.7 4.65 18.4 5.1 V11.4 C17.7 10.95 16.6 10.65 15 11.2 C11.8 12.3 9 9.6 6 10.9 Z" />
    </NavGlyph>
  );
}

/** Trophy — cup, side handles, stem and base. */
function TrophyGlyph() {
  return (
    <NavGlyph>
      <path d="M7.5 4.8 H16.5 V8.4 A4.5 4.5 0 0 1 7.5 8.4 Z" />
      <path d="M7.5 5.8 H5.2 A0.7 0.7 0 0 0 4.5 6.5 C4.5 8.6 6 10 8 10.2" />
      <path d="M16.5 5.8 H18.8 A0.7 0.7 0 0 1 19.5 6.5 C19.5 8.6 18 10 16 10.2" />
      <path d="M12 12.4 V15" />
      <path d="M9.6 15 H14.4 L15.2 18.9 H8.8 Z" />
    </NavGlyph>
  );
}

/** Vault — a rounded strongbox with a centred dial (matches the concept's mark). */
function VaultGlyph() {
  return (
    <NavGlyph>
      <rect x="4.6" y="5.2" width="14.8" height="13.6" rx="4" />
      <circle cx="12" cy="12" r="2.4" />
    </NavGlyph>
  );
}

const itemBase: React.CSSProperties = {
  flex: 1,
  minWidth: 44,
  minHeight: 44,
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  background: "transparent",
  border: "none",
  padding: 0,
  lineHeight: 1,
};

/** The premium (Starter) dock label — quiet, small, under its icon. Sized to 9.5px in English and
 *  shrunk to fit its slot when a translation is longer (e.g. Home → "Ana Sayfa") so the dock keeps
 *  one line per label without changing the bar height or spacing. FitText owns the font-size. */
function NavLabel({ label, color, style }: { label: string; color?: string; style?: React.CSSProperties }) {
  return (
    <FitText
      size={9.5}
      min={0.66}
      style={{
        ...navLabel,
        color: color ?? navLabel.color,
        width: "100%",
        whiteSpace: "nowrap",
        overflow: "hidden",
        textAlign: "center",
        ...style,
      }}
    >
      {label}
    </FitText>
  );
}

const navLabel: React.CSSProperties = {
  fontWeight: 650,
  letterSpacing: "0.02em",
  lineHeight: 1,
  color: "var(--muted)",
};
