import type { CampaignArc, CampaignLevel, CampaignWorld } from "@/api/client";
import type { Dict } from "@/i18n";
import { fmt, useT } from "@/i18n/useT";
import { arcName, levelTitle } from "@/i18n/campaignTitles";
import { useI18n } from "@/store/i18n";
import { cosmicArt } from "@/assets/campaign";
import { starterWorldArtFor, type StarterWorldArt } from "@/assets/campaign/starter";
import { worldFlavor, worldTheme } from "@/lib/campaign";
import { CampaignWorldHeader } from "@/screens/campaign/components/CampaignWorldHeader";
import { QuestPath } from "@/screens/campaign/components/QuestPath";
import { WorldHorizon } from "@/screens/campaign/components/scenery";
import { useArtStyle, useStarterSystem } from "@/theme/useArtStyle";
import { CrownIcon } from "@/ui/CrownIcon";
import { FitText } from "@/ui/FitText";

// Mirrors backend CAMPAIGN_COIN_FIRST_CLEAR (core/constants.py) — the base coins a first clear
// grants. Display-only: the server is authoritative for what's actually awarded.
const CAMPAIGN_COIN_FIRST_CLEAR = 25;

const shell: React.CSSProperties = {
  position: "relative",
  width: "100%",
  maxWidth: 480,
  margin: "0 auto",
  // Bottom padding clears the floating bottom nav PLUS the centre play button's overflow above it,
  // so the trailhead (moon base + mission card) never hides behind either.
  padding: "calc(clamp(14px, 4vw, 22px) + env(safe-area-inset-top)) clamp(12px, 3.5vw, 18px) calc(148px + env(safe-area-inset-bottom))",
  display: "flex",
  flexDirection: "column",
  gap: 14,
};

/** The mono ladder shell: same clearances, themable stack gap (the mono skins open it up). */
const monoShell: React.CSSProperties = {
  ...shell,
  gap: "var(--gap-shell, 14px)",
};

/** A world's quest map: a viewport-fixed world horizon (the adventure you climb into) with a flat
 * header and the perspective quest road floating in front of it. */
export function CampaignLadder({
  world,
  dailyEarned,
  dailyCap,
  onBack,
  onPlay,
}: {
  world: CampaignWorld;
  dailyEarned: number;
  dailyCap: number;
  onBack: () => void;
  onPlay: (level: number) => void;
}) {
  const t = useT();
  const mono = useArtStyle() === "mono";
  const theme = worldTheme(world.world);
  // The world's own badge + scene — only on the Starter system. The Minimal pair is art-less and
  // frozen, so it stays on the cosmic header it already has (see WorldHeader).
  const starterArt = useStarterSystem();

  // Mono (Starter): a premium Science journey — a cosmic world-header card, a "Next Up" mission
  // card, then the chapters as progress sections threaded on a single vertical journey line, each
  // level a state node (cleared / current / locked / boss). No horizon/road art; pure token surface.
  if (mono) {
    const flavor = worldFlavor(t, world.world);
    const title = (flavor.title ?? world.world).toUpperCase();
    const nextUp = world.arcs.flatMap((a) => a.levels).find((l) => l.unlocked && !l.cleared) ?? null;
    return (
      <main style={monoShell}>
        <WorldHeader
          t={t}
          title={title}
          subtitle={flavor.subtitle}
          clearedCount={world.cleared_count}
          total={world.total_levels}
          dailyEarned={dailyEarned}
          dailyCap={dailyCap}
          onBack={onBack}
          art={starterArt ? starterWorldArtFor(world.world) : null}
        />
        {nextUp && <NextUpCard t={t} level={nextUp} onPlay={() => onPlay(nextUp.level_number)} />}
        {world.arcs.map((arc) => (
          <ChapterCard key={arc.name} t={t} arc={arc} onPlay={onPlay} />
        ))}
      </main>
    );
  }

  return (
    <>
      {/* Fixed world atmosphere behind everything on this screen (unmounts with it). */}
      <WorldHorizon theme={theme} />
      <main style={shell}>
        <div style={{ position: "relative", zIndex: 1, display: "flex", flexDirection: "column", gap: 14 }}>
          <CampaignWorldHeader
            world={world}
            dailyEarned={dailyEarned}
            dailyCap={dailyCap}
            onBack={onBack}
          />
          <QuestPath world={world} onPlay={onPlay} />
        </div>
      </main>
    </>
  );
}

const statChip: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  fontSize: 13,
  fontWeight: 600,
  color: "var(--muted)",
};

/** The world header — an establishing hero: the world's own scene fading out of the panel, with the
 * title + journey stats held on the panel's left.
 *
 * **No category medallion.** One floated top-right until it was removed: the medallion is the hub
 * list's job (it is how you pick a world), and repeating it here restated an answer the player had
 * already given by tapping in — competing with the scene that is meant to do the establishing. The
 * hub rows still carry it (`StarterWorldRow` / `StarterCurrentWorld` read the same `art.badge`), so
 * don't "restore" it here from those.
 *
 * The scene was built Science-first and stayed that way: `cosmicArt.layerNebula` is Science's nebula
 * and was rendered for EVERY world, so History opened on a violet nebula. On the Starter system it
 * now reads the world's own art, the same `starterWorldArtFor` pair the hub rows use, so the header
 * actually establishes the world you opened.
 *
 * The art is gated on the Starter system because this whole mono branch is shared with the Minimal
 * pair, which is art-less and FROZEN (tokens.ts UNIQUE_THEME_IDS) — with no `art`, it keeps exactly
 * the header it has today, cosmic backdrop and all. */
function WorldHeader({
  t,
  title,
  subtitle,
  clearedCount,
  total,
  dailyEarned,
  dailyCap,
  onBack,
  art,
}: {
  t: Dict;
  title: string;
  subtitle: string;
  clearedCount: number;
  total: number;
  dailyEarned: number;
  dailyCap: number;
  onBack: () => void;
  /** This world's own badge + scene, or null on the art-less Minimal pair. */
  art: StarterWorldArt | null;
}) {
  return (
    <section className="rr-glass" style={{ position: "relative", overflow: "hidden", padding: 0, borderRadius: 26 }}>
      <span
        aria-hidden
        style={{
          position: "absolute",
          inset: 0,
          backgroundImage: `url(${art ? art.scene : cosmicArt.layerNebula})`,
          backgroundSize: art ? "contain" : "cover",
          backgroundPosition: art ? "right center" : "62% center",
          backgroundRepeat: "no-repeat",
        }}
      />
      {/* Panel wash so the copy column stays crisp and the scene only breathes through on the right.
          On the Starter system it reaches further across than it used to (30% → 46%), because the
          stats row runs under the art and "0 / 300 coins today" was unreadable against it. The old
          stops are kept for the art-less path so the frozen Minimal pair renders exactly as before —
          this is Starter-system work, and it must not reach them. */}
      <span
        aria-hidden
        style={{
          position: "absolute",
          inset: 0,
          background: art
            ? "linear-gradient(96deg, var(--panel) 46%, color-mix(in srgb, var(--panel) 62%, transparent) 68%, transparent 92%)"
            : "linear-gradient(96deg, var(--panel) 30%, color-mix(in srgb, var(--panel) 60%, transparent) 52%, transparent 84%)",
        }}
      />
      <div style={{ position: "relative", zIndex: 1, padding: "16px 18px 18px", display: "flex", flexDirection: "column", gap: 6, maxWidth: "74%" }}>
        <button
          type="button"
          onClick={onBack}
          style={{
            alignSelf: "flex-start",
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
            padding: 0,
            background: "transparent",
            border: "none",
            cursor: "pointer",
            fontSize: 13,
            fontWeight: 700,
            color: "var(--text)",
          }}
        >
          ‹ {t.campaign.journey}
        </button>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 11, marginTop: 2 }}>
          {/* HexAtom is an ATOM in a hexagon — Science's mark, and it sat beside every world's name.
              Where the world's own medallion is shown it is both wrong and redundant, so it is kept
              only for the art-less path (the frozen Minimal pair), whose header is unchanged. */}
          {!art && <HexAtom />}
          <span className="display" style={{ fontSize: "clamp(30px, 9.5vw, 40px)", lineHeight: 0.92, letterSpacing: "0.005em" }}>
            {title}
          </span>
        </span>
        {subtitle && <span style={{ color: "var(--muted)", fontSize: 15, fontWeight: 600 }}>{subtitle}</span>}
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 6 }}>
          <span style={statChip}>
            <RingGlyph /> {fmt(t.campaign.clearedShort, { cleared: clearedCount, total })}
          </span>
          <span aria-hidden style={{ width: 1, height: 15, background: "var(--line)" }} />
          <span style={statChip}>
            <CoinGlyph size={16} />{" "}
            <span style={{ color: "var(--text)", fontWeight: 700 }}>
              {dailyEarned} / {dailyCap}
            </span>{" "}
            {t.campaign.coinsToday}
          </span>
        </div>
      </div>
    </section>
  );
}

/** The "Next Up" mission card — a rocket disc, the mission name + arc, its coin reward, and the
 * bold Start Level CTA. The clear next thing to do on this world. */
function NextUpCard({ t, level, onPlay }: { t: Dict; level: CampaignLevel; onPlay: () => void }) {
  const locale = useI18n((st) => st.locale);
  return (
    <section
      className="rr-glass"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 13,
        padding: "14px 14px",
        borderRadius: 22,
        border: "1px solid color-mix(in srgb, var(--brand) 24%, var(--line))",
        boxShadow: "inset 0 1px 0 var(--sheen), 0 10px 26px color-mix(in srgb, var(--brand) 12%, transparent)",
      }}
    >
      <span
        style={{
          position: "relative",
          flex: "none",
          width: 62,
          height: 62,
          borderRadius: "50%",
          display: "grid",
          placeItems: "center",
          background: "radial-gradient(120% 120% at 50% 0%, color-mix(in srgb, var(--brand) 16%, var(--panel)), color-mix(in srgb, var(--brand) 8%, var(--panel2)))",
          border: "1px solid color-mix(in srgb, var(--brand) 20%, var(--line))",
          boxShadow: "inset 0 1px 0 var(--sheen)",
        }}
      >
        <RocketGlyph />
        <span
          aria-hidden
          style={{ position: "absolute", bottom: 3, right: 5, width: 13, height: 13, borderRadius: "50%", background: "var(--brand)", border: "2.5px solid var(--panel)" }}
        />
      </span>
      <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 1 }}>
        <span style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: "0.16em", textTransform: "uppercase", color: "var(--muted)" }}>
          {t.campaign.nextUp}
        </span>
        <FitText as="span" className="display" size={19} min={0.62} axis="x" style={{ lineHeight: 1.12, color: "var(--text)", width: "100%", overflow: "hidden", whiteSpace: "nowrap" }}>
          {levelTitle(level.title, locale)}
        </FitText>
        <span style={{ fontSize: 12.5, fontWeight: 500, color: "var(--muted)" }}>
          {fmt(t.campaign.levelArc, { n: level.level_number, arc: arcName(level.arc_name, locale) })}
        </span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6, marginTop: 3, fontSize: 12, fontWeight: 600, color: "var(--muted)" }}>
          <CoinGlyph size={14} /> {fmt(t.campaign.coinsAvailable, { n: CAMPAIGN_COIN_FIRST_CLEAR })}
        </span>
      </span>
      <button
        type="button"
        onClick={onPlay}
        className="rr-tap"
        style={{
          flex: "none",
          display: "inline-flex",
          alignItems: "center",
          gap: 8,
          padding: "12px 16px",
          borderRadius: 16,
          border: "none",
          background: "var(--cta)",
          color: "var(--ctaText)",
          fontWeight: 700,
          fontSize: 13.5,
          cursor: "pointer",
          boxShadow: "0 8px 18px color-mix(in srgb, var(--brand) 30%, transparent), inset 0 1px 0 rgba(255,255,255,.28)",
        }}
      >
        {t.campaign.startLevel} <ArrowGlyph />
      </button>
    </section>
  );
}

/** One chapter (arc) as a progress section: a header (node · name · progress bar · count) and its
 * level rows, all threaded on a single vertical journey line down the left. */
function ChapterCard({ t, arc, onPlay }: { t: Dict; arc: CampaignArc; onPlay: (n: number) => void }) {
  const locale = useI18n((st) => st.locale);
  const clearedInArc = arc.levels.filter((l) => l.cleared).length;
  const pct = arc.levels.length ? clearedInArc / arc.levels.length : 0;
  return (
    <section className="rr-glass" style={{ position: "relative", padding: "4px 18px 12px", borderRadius: 22 }}>
      {/* The journey line the nodes sit on. */}
      <span aria-hidden style={{ position: "absolute", left: 30, top: 30, bottom: 26, width: 2, borderRadius: 2, background: "color-mix(in srgb, var(--brand) 15%, var(--line))" }} />
      <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "14px 0 10px" }}>
        <span style={{ position: "relative", zIndex: 1, flex: "none", width: 24, display: "grid", placeItems: "center" }}>
          <span style={{ width: 10, height: 10, borderRadius: "50%", background: "color-mix(in srgb, var(--brand) 42%, var(--line))", border: "2px solid var(--panel)" }} />
        </span>
        <span style={{ fontSize: 11, letterSpacing: "0.2em", textTransform: "uppercase", fontWeight: 800, color: "var(--muted)" }}>{arcName(arc.name, locale)}</span>
        <span style={{ flex: 1, minWidth: 24, height: 4, borderRadius: 999, background: "var(--line)", overflow: "hidden" }}>
          <span style={{ display: "block", height: "100%", width: `${Math.round(pct * 100)}%`, background: "var(--brand)", borderRadius: 999 }} />
        </span>
        <span style={{ flex: "none", fontSize: 12, fontWeight: 700, color: "var(--muted)", fontVariantNumeric: "tabular-nums" }}>
          {clearedInArc}/{arc.levels.length}
        </span>
      </div>
      {arc.levels.map((level) => (
        <LevelRow key={level.level_number} t={t} level={level} onPlay={onPlay} />
      ))}
    </section>
  );
}

/** A single level row on the journey line: a state node, number, title (+ Boss Level), and a
 * state-appropriate trailing status. Locked rows are grayed back (the boss keeps its gold node). */
function LevelRow({ t, level, onPlay }: { t: Dict; level: CampaignLevel; onPlay: (n: number) => void }) {
  const locale = useI18n((st) => st.locale);
  const locked = !level.unlocked;
  const cleared = level.cleared;
  const boss = level.is_boss;
  const current = level.unlocked && !level.cleared;
  return (
    <button
      type="button"
      disabled={locked}
      onClick={() => !locked && onPlay(level.level_number)}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        width: "100%",
        padding: "11px 6px 11px 0",
        background: current ? "color-mix(in srgb, var(--brand) 7%, transparent)" : "transparent",
        borderRadius: current ? 14 : 0,
        border: "none",
        cursor: locked ? "default" : "pointer",
        textAlign: "left",
        color: "inherit",
        opacity: locked && !boss ? 0.6 : 1,
        transition: "opacity 120ms ease",
      }}
    >
      <span style={{ position: "relative", zIndex: 1, flex: "none", width: 24, display: "grid", placeItems: "center" }}>
        <LevelNodeDot state={locked ? "locked" : cleared ? "cleared" : "current"} boss={boss} />
      </span>
      <span style={{ flex: "none", width: 14, fontSize: 15, fontWeight: 600, color: locked ? "var(--faint)" : "var(--muted)", fontVariantNumeric: "tabular-nums", textAlign: "center" }}>
        {level.level_number}
      </span>
      <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 1 }}>
        <FitText as="span" className="display" size={17} min={0.62} axis="x" style={{ lineHeight: 1.15, color: locked ? "var(--muted)" : "var(--text)", width: "100%", overflow: "hidden", whiteSpace: "nowrap" }}>
          {levelTitle(level.title, locale)}
        </FitText>
        {boss && <span style={{ fontSize: 11.5, fontWeight: 600, color: "var(--brand)" }}>{t.campaign.bossLevel}</span>}
      </span>

      {cleared ? (
        <span style={{ flex: "none", display: "inline-flex", alignItems: "center", gap: 8, fontSize: 13, fontWeight: 600, color: "var(--muted)", fontVariantNumeric: "tabular-nums" }}>
          {level.pending && <PendingDot label={t.campaign.pending} />}
          {level.best_correct}/10 <ChevronGlyph />
        </span>
      ) : boss ? (
        <span style={{ flex: "none", display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, fontWeight: 700, color: "var(--brand)" }}>
          {t.campaign.bossShort} <CrownIcon size={16} style={{ filter: "none" }} />
          {locked ? <LockGlyph /> : <ChevronGlyph color="var(--brand)" />}
        </span>
      ) : current ? (
        <span style={{ flex: "none", display: "inline-flex", alignItems: "center", gap: 8 }}>
          <span
            style={{
              padding: "4px 12px",
              borderRadius: 999,
              fontSize: 12,
              fontWeight: 700,
              color: "var(--brand)",
              background: "color-mix(in srgb, var(--brand) 12%, var(--panel2))",
              border: "1px solid color-mix(in srgb, var(--brand) 22%, var(--line))",
            }}
          >
            {t.campaign.current}
          </span>
          <ChevronGlyph color="var(--brand)" />
        </span>
      ) : (
        <span style={{ flex: "none", display: "inline-flex", alignItems: "center", gap: 8, fontSize: 13, fontWeight: 500, color: "var(--faint)" }}>
          {t.campaign.lockedShort} <LockGlyph />
        </span>
      )}
    </button>
  );
}

/** The state node that sits on the journey line. Boss = a gold crowned node; cleared = a filled
 * brand check; current = a brand target ring; locked = a small quiet dot. */
function LevelNodeDot({ state, boss }: { state: "cleared" | "current" | "locked"; boss: boolean }) {
  if (boss) {
    return (
      <span
        style={{
          width: 30,
          height: 30,
          borderRadius: "50%",
          display: "grid",
          placeItems: "center",
          background: "radial-gradient(120% 120% at 50% 25%, color-mix(in srgb, var(--amber) 28%, var(--panel)), var(--panel))",
          border: "2px solid var(--amber)",
          boxShadow: "0 0 12px color-mix(in srgb, var(--amber) 30%, transparent)",
          color: "var(--amber)",
        }}
      >
        <CrownIcon size={16} style={{ filter: "none" }} />
      </span>
    );
  }
  if (state === "cleared") {
    return (
      <span
        style={{
          width: 24,
          height: 24,
          borderRadius: "50%",
          display: "grid",
          placeItems: "center",
          background: "linear-gradient(180deg, var(--brand-2), var(--brand))",
          boxShadow: "0 2px 6px color-mix(in srgb, var(--brand) 34%, transparent)",
        }}
      >
        <CheckGlyph color="#fff" />
      </span>
    );
  }
  if (state === "current") {
    return (
      <span
        style={{
          width: 24,
          height: 24,
          borderRadius: "50%",
          display: "grid",
          placeItems: "center",
          background: "var(--panel)",
          border: "2.5px solid var(--brand)",
          boxShadow: "0 0 0 4px color-mix(in srgb, var(--brand) 12%, transparent)",
        }}
      >
        <span style={{ width: 9, height: 9, borderRadius: "50%", background: "var(--brand)" }} />
      </span>
    );
  }
  return <span style={{ width: 12, height: 12, borderRadius: "50%", background: "color-mix(in srgb, var(--faint) 40%, var(--panel2))", border: "1px solid var(--line)" }} />;
}

/** A subtle "cleared offline, awaiting sync" marker on a level row — a small amber dot + label.
 * Reduced-motion-safe (no animation); it just says the clear hasn't been confirmed by the server. */
function PendingDot({ label }: { label: string }) {
  return (
    <span
      title={label}
      aria-label={label}
      style={{ display: "inline-flex", alignItems: "center", gap: 4, color: "var(--amber)", fontSize: 11, fontWeight: 700 }}
    >
      <span aria-hidden style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--amber)" }} />
      {label}
    </span>
  );
}

/** A hexagon science badge with a purple atom — the mark beside the world title. */
function HexAtom() {
  return (
    <span
      aria-hidden
      style={{
        flex: "none",
        width: 44,
        height: 44,
        display: "grid",
        placeItems: "center",
        clipPath: "polygon(25% 3%, 75% 3%, 100% 50%, 75% 97%, 25% 97%, 0% 50%)",
        background: "radial-gradient(120% 120% at 50% 0%, color-mix(in srgb, var(--brand) 22%, var(--panel)), color-mix(in srgb, var(--brand) 10%, var(--panel2)))",
      }}
    >
      <svg width={24} height={24} viewBox="0 0 24 24" fill="none" stroke="var(--brand)" strokeWidth={1.5}>
        <circle cx="12" cy="12" r="2" fill="var(--brand)" stroke="none" />
        <ellipse cx="12" cy="12" rx="9" ry="3.6" transform="rotate(30 12 12)" />
        <ellipse cx="12" cy="12" rx="9" ry="3.6" transform="rotate(-30 12 12)" />
        <ellipse cx="12" cy="12" rx="9" ry="3.6" transform="rotate(90 12 12)" />
      </svg>
    </span>
  );
}

/** A small ¾ progress ring — the cleared-stat marker. */
function RingGlyph() {
  return (
    <svg width={16} height={16} viewBox="0 0 24 24" fill="none" aria-hidden style={{ flex: "none" }}>
      <circle cx="12" cy="12" r="8.5" stroke="var(--line)" strokeWidth="2.4" />
      <path d="M12 3.5a8.5 8.5 0 0 1 7 13.3" stroke="var(--brand)" strokeWidth="2.4" strokeLinecap="round" />
    </svg>
  );
}

/** A small polished gold coin — the reward marker (pure CSS, matches the header coin pill). */
function CoinGlyph({ size = 16 }: { size?: number }) {
  return (
    <span
      aria-hidden
      style={{
        flex: "none",
        width: size,
        height: size,
        borderRadius: "50%",
        display: "inline-block",
        background: "radial-gradient(120% 120% at 35% 28%, color-mix(in srgb, var(--amber) 55%, white), var(--amber))",
        border: "1px solid color-mix(in srgb, var(--amber) 78%, #6b4c0c)",
        boxShadow: "inset 0 0 0 2px color-mix(in srgb, var(--amber) 55%, white)",
      }}
    />
  );
}

/** A simple brand rocket — the Next Up mission emblem. */
function RocketGlyph() {
  return (
    <svg width={30} height={30} viewBox="0 0 24 24" fill="none" stroke="var(--brand)" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 2.5c3 1.8 4.8 4.8 4.8 8.2 0 2-.6 3.7-1.5 5L12 17l-3.3-1.3c-.9-1.3-1.5-3-1.5-5 0-3.4 1.8-6.4 4.8-8.2Z" />
      <circle cx="12" cy="9.5" r="1.7" fill="var(--brand)" stroke="none" />
      <path d="M8.7 15 6 17.6l2.8-.5M15.3 15 18 17.6l-2.8-.5" />
      <path d="M10.4 17.6c0 1.4.7 2.6 1.6 3.4.9-.8 1.6-2 1.6-3.4" />
    </svg>
  );
}

/** A forward arrow for the CTA. */
function ArrowGlyph() {
  return (
    <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden style={{ flex: "none" }}>
      <path d="M4 12h14M13 6l6 6-6 6" />
    </svg>
  );
}

/** A row chevron. */
function ChevronGlyph({ color = "var(--faint)" }: { color?: string }) {
  return (
    <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden style={{ flex: "none" }}>
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}

/** A small line-art padlock — the marker on a locked level row. */
function LockGlyph() {
  return (
    <svg width={14} height={14} viewBox="0 0 24 24" fill="none" aria-hidden style={{ flex: "none", color: "var(--faint)" }}>
      <rect x="5" y="10.5" width="14" height="10" rx="2.5" stroke="currentColor" strokeWidth="1.8" />
      <path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

/** A crisp check — the cleared-node mark (defaults to lime, white inside the brand node). */
function CheckGlyph({ color = "var(--lime)" }: { color?: string }) {
  return (
    <svg width={14} height={14} viewBox="0 0 24 24" fill="none" aria-hidden style={{ flex: "none", color }}>
      <path d="M5 13l4.5 4.5L19 7" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
