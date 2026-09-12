import { useEffect, useMemo, useState } from "react";
import { api, type FriendsBoardResponse } from "@/api/client";
import { fmt, useT } from "@/i18n/useT";
import type { Dict } from "@/i18n/en";
import { Avatar } from "@/screens/home/Avatar";
import { HomeHeader } from "@/screens/home/HomeHeader";
import { ProfileMenu } from "@/screens/home/ProfileMenu";
import type { Me } from "@/store/session";
import podiumImg from "@/assets/leaderboard/podium.webp";
import { CrownIcon } from "@/ui/CrownIcon";
import { FitText } from "@/ui/FitText";
import { GoldButton } from "@/ui/GoldButton";
import { Skeleton, SkeletonRow } from "@/ui/Skeleton";
import { getTitle, titleFlairStyle } from "@/theme/identity";
import type { LeaderboardRowData } from "./LeaderboardRow";
import { activeTag } from "@/i18n/format";

// Audience filters ONLY — who is in the field. The timeframe (always today's Daily Royale) is stated
// once, plainly, in the context line beneath. "This Week" was a phantom segment (identical data to
// Global); removing it kills the three-contradictory-timeframes confusion.
type Tab = "global" | "friends";
const TABS: Tab[] = ["global", "friends"];

/* ---- refined surface + shadow language, TOKEN-DERIVED so every skin repaints it ----
 *
 * This screen serves the whole Starter SYSTEM — Starter plus every skin of it, roughly half of them
 * dark (Midnight Arcade, Apex, Crown Arena, Champion) and half light (Daylight, Bubblegum,
 * Evergreen). It used to be literal ivory and violet, so a dark skin got a white leaderboard bolted
 * into a black app. Every surface value below now resolves from the equipped theme's own vars.
 *
 * Two rules make one definition work in both polarities, and they are the whole trick:
 *
 *  - ELEVATION comes from the border + `--sheen`, not from the shadow. `--sheen` is the one token
 *    already tuned per polarity by every theme (a bright specular gloss on the light skins, a
 *    whisper rim on the dark ones), so the top-edge light-catch reads correctly either way. The
 *    shadows stay NEUTRAL ink rather than the old purple: a tinted shadow fights a green or pink
 *    skin, and on the dark skins shadows barely register anyway — there the cards lift because
 *    `--panel` is lighter than `--bg`, which is true of every dark theme in the catalog.
 *  - ACCENT comes from `--brand` / `--cta` via color-mix, never a hex. `--cta` in particular is
 *    each theme's own signature pill gradient, which is exactly what the tab indicator and the
 *    progress fill want to be.
 *
 * This mirrors `campaign/components/starter/starterSurface.ts` — the same premium panel, expressed
 * inline because this screen composes on top of it.
 */
const FINE_BORDER = "1px solid var(--line)";
const SHADOW_CARD =
  "0 1px 1px rgba(17,17,17,.04), 0 6px 16px rgba(17,17,17,.06), 0 22px 40px rgba(17,17,17,.05)";
const INNER_HI = "inset 0 1px 0 var(--sheen)";
// The card face: the theme's panel, lit from the top edge by INNER_HI. The faint drift toward
// `--panel2` keeps the light skins' warm gradient (Starter: #FFFFFF → #FCFAFE) and is imperceptible
// on the dark ones, where the two panels sit ~5% apart.
const CARD_FACE =
  "linear-gradient(180deg, var(--panel) 0%, color-mix(in srgb, var(--panel2) 35%, var(--panel)) 100%)";

// One interface type treatment for ALL player identity (podium names, Your Rank, rows) so a player
// doesn't change personality by position. The brand serif stays reserved for the wordmark only.
const NAME_FONT = "'Sora', system-ui, sans-serif";
// One treatment for ALL numeric data (ranks, scores, targets) — tabular, aligned, consistent.
const NUM: React.CSSProperties = { fontFamily: NAME_FONT, fontVariantNumeric: "tabular-nums", letterSpacing: "-0.01em" };

// Champagne gold / lilac-silver / warm bronze — soft light, not saturated metal.
// DELIBERATELY literal, and the only literals left on this screen. Gold-silver-bronze is what first,
// second and third MEAN; re-mixing them per theme would make Evergreen's silver green and cost the
// medals the one thing they communicate. They also need no help: metals carry their own light, so
// they read on the ivory skins and the dark ones alike. The stage AROUND them is what follows the
// theme (see the podium tint below).
const METAL: Record<
  1 | 2 | 3,
  { ring: string; glow: string; light: string; mid: string; dark: string }
> = {
  1: {
    ring: "linear-gradient(140deg, #FBEFC7 0%, #ECD08A 40%, #C9A24E 72%, #EAD79E 100%)",
    glow: "rgba(206,164,84,.30)",
    light: "#FBEFC4",
    mid: "#E4C57A",
    dark: "#B4882E",
  },
  2: {
    ring: "linear-gradient(140deg, #FBFCFF 0%, #DDE0EC 40%, #B2B7CB 72%, #E7E9F1 100%)",
    glow: "rgba(150,156,186,.20)",
    light: "#FBFCFF",
    mid: "#D2D6E4",
    dark: "#9AA0B6",
  },
  3: {
    ring: "linear-gradient(140deg, #F6DEC1 0%, #DCAE7C 40%, #B47C48 72%, #EAC59B 100%)",
    glow: "rgba(184,128,74,.20)",
    light: "#F5DCBE",
    mid: "#D2A06E",
    dark: "#A06A38",
  },
};

const shell: React.CSSProperties = {
  width: "100%",
  maxWidth: 480,
  minHeight: "100dvh",
  margin: "0 auto",
  padding:
    "calc(clamp(10px, 3vw, 14px) + env(safe-area-inset-top)) clamp(12px, 3.4vw, 16px) calc(120px + env(safe-area-inset-bottom))",
  display: "flex",
  flexDirection: "column",
  gap: 10,
  // NO background of its own. This used to paint a literal ivory field, which meant the page under a
  // dark skin stayed cream no matter what was equipped. `body` already paints `var(--bg)` — the
  // theme's own lit room, complete with the root's vignette and grain layers (global.css) — so the
  // right move is to let it through rather than to re-derive it here and drift from it.
};

function cardSurface(overrides?: React.CSSProperties): React.CSSProperties {
  return {
    position: "relative",
    background: CARD_FACE,
    border: FINE_BORDER,
    borderRadius: 20,
    boxShadow: `${INNER_HI}, ${SHADOW_CARD}`,
    ...overrides,
  };
}

/**
 * The Starter-system Leaderboard — a restrained royal hall of honor. Branded header + a tactile
 * two-segment audience filter (Global / Friends), one plain "Today's Royale" context line, a single
 * sculpted three-step podium (each portrait the player's own equipped icon), a compact Your Rank
 * checkpoint that reflects ONLY today's field (never a mixed global/rating snapshot), and a dense
 * run of standard rows beneath. All data is real (window field · friends board); nothing is mocked.
 */
export function StarterLeaderboard({
  me,
  rows,
  windowState,
  settleAt,
  openWindowId,
  loading,
  serverMyRank = null,
  serverMyScore = 0,
  onVault,
}: {
  me: Me;
  rows: LeaderboardRowData[];
  windowState: string | null;
  settleAt: string | null;
  openWindowId: string | null;
  loading: boolean;
  /** The caller's server-computed rank/score over the FULL window field (the `rows` list is only
   *  the top slice). Used for the Your Rank card when the player scored below the slice and so isn't
   *  in `rows`. For fields within the slice the player IS in `rows`, so these change nothing. Global
   *  tab only — the Friends board carries its own ranks. */
  serverMyRank?: number | null;
  serverMyScore?: number;
  onVault?: () => void;
}) {
  const t = useT();
  const [tab, setTab] = useState<Tab>("global");
  const [menuOpen, setMenuOpen] = useState(false);
  const [friends, setFriends] = useState<FriendsBoardResponse | null>(null);
  const [friendsLoading, setFriendsLoading] = useState(false);
  // Distinct from "no friends played": a FAILED friends fetch renders an error with a retry (which
  // clears this flag so the effect refires) — before, failure was indistinguishable from an empty
  // board and never retried for the life of the mount.
  const [friendsError, setFriendsError] = useState(false);

  useEffect(() => {
    if (tab !== "friends" || !openWindowId || friends || friendsError) return;
    setFriendsLoading(true);
    api
      .friendsBoard(openWindowId)
      .then(setFriends)
      .catch(() => setFriendsError(true))
      .finally(() => setFriendsLoading(false));
  }, [tab, openWindowId, friends, friendsError]);

  const friendEntries: LeaderboardRowData[] = useMemo(
    () =>
      (friends?.played ?? []).map((r) => ({
        rank: r.rank,
        username: r.username,
        score: r.score,
        isMe: r.is_me,
        avatar_preset: r.avatar_preset,
        equipped_frame: r.equipped_frame,
        equipped_title: r.equipped_title,
      })),
    [friends],
  );

  const entries = tab === "friends" ? friendEntries : rows;
  // The friends tab counts as loading from the moment it's selected until data or an error lands —
  // `friendsLoading` alone starts false, which flashed "no friends have played" for the render
  // between selecting the tab and the fetch effect running.
  const isLoading =
    tab === "friends" ? friendsLoading || (!friends && !friendsError && !!openWindowId) : loading;

  const podium = entries.slice(0, 3);
  // The standard rows: the WHOLE field from rank 1 down, EXCEPT the player (their standing is the
  // Your Rank card, so it's never duplicated in the list). The top three appear here as well as on
  // the podium — deliberately. The list is the readable ranking, and one that opens at 4th reads as
  // if the numbering is broken; the podium is a flourish on top of it, not the first page of it.
  const list = entries.filter((e) => !e.isMe);

  const youEntry = entries.find((e) => e.isMe) ?? null;
  // On the GLOBAL tab the server tells us the caller's true standing over the whole field, so a
  // player who scored below the visible top slice (and is therefore absent from `entries`) still
  // shows a correct rank. On the Friends tab that server value doesn't apply — use the friend row.
  const serverEntered = tab === "global" && serverMyRank != null;
  const entered = youEntry != null || serverEntered;
  const provisional = windowState !== "SETTLED";

  // Everything about the Your Rank card comes from TODAY'S field only. No global-rank / rating / league
  // fallback — if the player hasn't entered today, the honest state is "not on the board yet".
  const yourRank = youEntry?.rank ?? (serverEntered ? serverMyRank : null);
  const yourScore = youEntry?.score ?? (serverEntered ? serverMyScore : 0);
  // "X to next rank" needs the entry directly above, which only exists when the player is in the
  // visible list. A below-slice player just sees their rank + score (no next-rank target).
  const above =
    youEntry && youEntry.rank > 1 ? entries.find((e) => e.rank === youEntry.rank - 1) : undefined;
  const toNext = above ? Math.max(0, above.score - yourScore) : null;
  const nextRankNum = above?.rank ?? null;
  const nextPct = above && above.score > 0 ? Math.min(100, Math.round((yourScore / above.score) * 100)) : 0;
  const isChampion = yourRank === 1;

  return (
    <main style={shell}>
      <HomeHeader
        coins={me.coins_balance}
        avatarPreset={me.avatar_preset}
        equippedFrame={me.equipped_frame}
        onOpenMenu={() => setMenuOpen(true)}
        onOpenVault={onVault ?? (() => {})}
      />

      <Tabs tab={tab} onTab={setTab} t={t} />

      <ContextLine provisional={provisional} settleAt={settleAt} t={t} />

      {isLoading && entries.length === 0 ? (
        // Skeleton of the board's real shape — podium, Your Rank card, rows — so the wait keeps
        // the page's layout instead of a bare loading line.
        <div aria-busy aria-label={t.campaign.loading} style={{ display: "grid", gap: 12 }}>
          <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "center", gap: 16, padding: "12px 0 4px" }}>
            <Skeleton width={68} height={88} radius={16} />
            <Skeleton width={76} height={110} radius={16} />
            <Skeleton width={68} height={76} radius={16} />
          </div>
          <Skeleton height={86} radius={18} />
          <div style={cardSurface({ padding: "12px 14px", display: "grid", gap: 14 })}>
            {[0, 1, 2, 3].map((i) => (
              <SkeletonRow key={i} />
            ))}
          </div>
        </div>
      ) : tab === "friends" && friendsError && entries.length === 0 ? (
        <Centered>
          {t.leaderboard.errLoad}
          <GoldButton
            idlePulse={false}
            onClick={() => setFriendsError(false)}
            style={{ maxWidth: 200, margin: "12px auto 0" }}
          >
            {t.common.retry}
          </GoldButton>
        </Centered>
      ) : entries.length === 0 ? (
        <Centered>{tab === "friends" ? t.leaderboard.friendsEmpty : t.leaderboard.noScoresYet}</Centered>
      ) : (
        <>
          <Podium podium={podium} />

          <YourRankCard
            me={me}
            entered={entered}
            rank={yourRank}
            score={yourScore}
            toNext={toNext}
            nextRankNum={nextRankNum}
            nextPct={nextPct}
            isChampion={isChampion}
            t={t}
          />

          {list.length > 0 && (
            <div style={cardSurface({ padding: "2px 14px" })}>
              {list.map((row, i) => (
                <TopRow key={`${row.rank}-${row.username}`} row={row} first={i === 0} />
              ))}
            </div>
          )}
        </>
      )}

      {menuOpen && (
        <ProfileMenu
          username={me.username}
          avatarPreset={me.avatar_preset}
          equippedFrame={me.equipped_frame}
          equippedBadges={me.equipped_badges}
          equippedTitle={me.equipped_title}
          onClose={() => setMenuOpen(false)}
          onOpenVault={() => {
            setMenuOpen(false);
            onVault?.();
          }}
        />
      )}
    </main>
  );
}

/* ---------------- Segmented audience filter (one shell, sliding tactile indicator) ---------------- */

function Tabs({ tab, onTab, t }: { tab: Tab; onTab: (t: Tab) => void; t: Dict }) {
  const idx = TABS.indexOf(tab);
  const items: { key: Tab; label: string; icon: (a: boolean) => React.ReactNode }[] = [
    { key: "global", label: t.leaderboard.tabGlobal, icon: (a) => <GlobeIcon active={a} /> },
    { key: "friends", label: t.leaderboard.tabFriends, icon: (a) => <FriendsIcon active={a} /> },
  ];
  return (
    <div
      role="tablist"
      style={{
        position: "relative",
        display: "flex",
        padding: 4,
        borderRadius: 15,
        // The recessed track, one step deeper than the cards it sits above: the theme's tinted
        // panel2 over its panel, pressed in by a neutral inner shadow and capped by the polarity's
        // own light-catch.
        background: "linear-gradient(180deg, color-mix(in srgb, var(--panel2) 80%, var(--panel)), var(--panel))",
        border: FINE_BORDER,
        boxShadow: "inset 0 1px 2px rgba(17,17,17,.06), 0 1px 0 var(--sheen)",
      }}
    >
      {/* sliding active indicator */}
      <span
        aria-hidden
        style={{
          position: "absolute",
          top: 4,
          bottom: 4,
          left: 4,
          width: "calc((100% - 8px) / 2)",
          transform: `translateX(${idx * 100}%)`,
          transition: "transform 300ms cubic-bezier(.4, 0, .2, 1)",
          borderRadius: 11,
          // `--cta` IS each theme's signature pill gradient — the same surface as the ENTER DAILY
          // ROYALE button. The old literal was Starter's violet, so Bubblegum's filter was purple
          // and Crown Arena's was purple. One token, and the selected segment now speaks the skin.
          background: "var(--cta)",
          boxShadow: "0 5px 13px color-mix(in srgb, var(--brand) 30%, transparent), inset 0 1px 0 rgba(255,255,255,.28)",
          pointerEvents: "none",
        }}
      />
      {items.map((it) => {
        const active = tab === it.key;
        return (
          <button
            key={it.key}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onTab(it.key)}
            style={{
              position: "relative",
              zIndex: 1,
              flex: 1,
              minWidth: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 6,
              padding: "8px 6px",
              borderRadius: 11,
              border: "none",
              background: "transparent",
              // The ink the theme itself chose to sit on that CTA surface, so a skin whose pill is
              // pale never gets white-on-white.
              color: active ? "var(--ctaText)" : "var(--muted)",
              fontFamily: NAME_FONT,
              fontWeight: 700,
              fontSize: 13,
              cursor: active ? "default" : "pointer",
              whiteSpace: "nowrap",
              overflow: "hidden",
              transition: "color 200ms",
            }}
          >
            <span aria-hidden style={{ display: "flex", flex: "none" }}>{it.icon(active)}</span>
            {/* A longer localized tab label shrinks to hold one line in its half of the track rather
                than ellipsizing; content-sized (min-width:0) so short English stays centred with the
                icon exactly as before. */}
            <FitText as="span" size={13} min={0.66} style={{ minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textAlign: "center" }}>
              {it.label}
            </FitText>
          </button>
        );
      })}
    </div>
  );
}

/* ---------------- Context line — the ONE timeframe statement + live/final status ---------------- */

function ContextLine({ provisional, settleAt, t }: { provisional: boolean; settleAt: string | null; t: Dict }) {
  let finalTime: string | null = null;
  if (provisional && settleAt) {
    const d = new Date(settleAt);
    // App language, viewer's zone: `[]` followed the BROWSER, so a French player saw "10:15 PM"
    // instead of "22:15". Hour cycle is left to the locale (en 12-hour, fr/tr 24-hour).
    if (!Number.isNaN(d.getTime()))
      finalTime = d.toLocaleTimeString(activeTag(), { hour: "numeric", minute: "2-digit" });
  }
  const status = provisional
    ? finalTime
      ? `${t.leaderboard.provisional} · ${fmt(t.leaderboard.finalAt, { time: finalTime })}`
      : t.leaderboard.provisional
    : t.leaderboard.finalStandings;
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 3, marginTop: -2 }}>
      <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: "0.16em", textTransform: "uppercase", color: "color-mix(in srgb, var(--brand) 62%, var(--muted))" }}>
        {t.leaderboard.todaysRoyale}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span
          aria-hidden
          style={{
            width: 6,
            height: 6,
            borderRadius: "50%",
            background: provisional ? "color-mix(in srgb, var(--brand) 78%, white)" : "var(--amber)",
            boxShadow: provisional ? "0 0 5px color-mix(in srgb, var(--brand) 55%, transparent)" : "0 0 5px color-mix(in srgb, var(--amber) 55%, transparent)",
          }}
        />
        <span style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: "0.005em", color: "var(--muted)" }}>{status}</span>
      </div>
    </div>
  );
}

/* ---------------- Podium (champion-stage art + the winners standing on it) ---------------- */

// Where each winner stands on the podium art, as % of the image box: x = the step's horizontal
// centre, yBottom = the step's top surface (the avatar's feet rest here). Tuned to podium.png.
// Deliberate avatar-size hierarchy: champion clearly leads, the two flanks are equal and subordinate.
// Geometry measured off podium.png (900×358). The art is internally SYMMETRIC about its own centre
// at x≈54% (champion cylinder centres there; the #2/#3 lobe tops sit symmetrically at ~27% / 81%).
// The art also sits ~4% right-of-centre in its canvas, so the whole podium is nudged left by 4%
// (see the Podium wrapper) to true-centre it on screen. yBottom = the step's top surface (feet); the
// two flanks share one height so they read as an even pair.
// yBottom is measured against each step's OWN top surface, not a shared line. Measured off the art:
// the centre pillar's surface runs 10.1% → 34.1% of the art height (34.1% is where its gold front
// rim starts); the flank surfaces run ~35.2% → ~60.6%. The flanks' 52% sits 66% of the way down
// their surface, and the champion's 26% is that same 66% down its own — so all three read as
// standing ON their step. (The champion was at 37%: past the pillar's front rim entirely, so it
// hung over the front FACE and looked sunk into the podium.)
const STEP: Record<1 | 2 | 3, { x: number; yBottom: number; size: number }> = {
  1: { x: 54, yBottom: 26, size: 64 },
  2: { x: 27, yBottom: 52, size: 64 },
  3: { x: 81, yBottom: 52, size: 64 },
};

/** Clips a wash to the podium's exact silhouette by driving a mask from the art itself, so the two
 *  theme layers below can never bleed onto the page around it or onto the portraits above it. Sized
 *  `100% 100%` to track the art's own responsive box rather than a fixed pixel size. */
const podiumMask: React.CSSProperties = {
  position: "absolute",
  inset: 0,
  WebkitMaskImage: `url(${podiumImg})`,
  maskImage: `url(${podiumImg})`,
  WebkitMaskSize: "100% 100%",
  maskSize: "100% 100%",
  WebkitMaskRepeat: "no-repeat",
  maskRepeat: "no-repeat",
  pointerEvents: "none",
};

function Podium({ podium }: { podium: LeaderboardRowData[] }) {
  const [first, second, third] = podium;
  // Reserve the title line only when a seat actually wears one. Titles arrive in the SAME payload as
  // the rest of the podium, so there is no "title pops in later" shift to guard against — a fixed
  // height would just leave ~10px of dead air under the scores on every board where nobody has one
  // equipped, which today is most of them.
  const anyTitle = podium.some((e) => getTitle(e.equipped_title) != null);
  return (
    // Top margin = headroom so the champion avatar + crown (which rise above the art) never collide
    // with the status line. translateX(-4%) corrects the art's built-in 4% right-offset so the whole
    // podium — art, avatars and names together — reads dead-centre on screen.
    // Headroom for the champion, which is anchored by its FEET and so hangs above the art box by
    // (100% − yBottom) of its own height ≈ 35px. With the crown removed that overhang shrank by the
    // crown's ~30px, so this margin came back down with it — enough for a real gap under the status
    // line, not the crowded overlap the crown used to force.
    <div style={{ position: "relative", width: "84%", maxWidth: 360, margin: "clamp(38px, 10vw, 50px) auto 0", transform: "translateX(-4%)" }}>
      {/* The lit stage the podium stands in: the theme's gold warmth over a wider pool of its brand
          light. Both are color-mixed, so the room changes colour with the skin — and the pool does
          most of its work on the dark skins, where a cream podium would otherwise float on black
          with nothing under it. */}
      <span
        aria-hidden
        style={{
          position: "absolute",
          inset: "-6% -8% -2%",
          background:
            "radial-gradient(52% 58% at 50% 46%, color-mix(in srgb, var(--amber) 15%, transparent), transparent 72%), radial-gradient(76% 70% at 50% 62%, color-mix(in srgb, var(--brand) 13%, transparent), transparent 74%)",
          pointerEvents: "none",
        }}
      />
      {/* the podium art with the three winners standing on it */}
      <div style={{ position: "relative" }}>
        <img
          src={podiumImg}
          alt=""
          aria-hidden
          draggable={false}
          style={{ display: "block", width: "100%", height: "auto", filter: "drop-shadow(0 10px 15px rgba(17,17,17,.13))" }}
        />
        {/* HUE — the podium wears the skin's own light. It is one fixed cream-and-gold bitmap and was
            the loudest thing on the screen that could not follow the theme: an ivory object dropped
            into Bubblegum's pink room or Apex's blue night. Rather than re-cut the art eight times,
            the SAME png drives a mask, so the wash lands on exactly the podium silhouette and
            nowhere else; `soft-light` tints it without flattening the sculpted shading or bleaching
            the gold rims, both of which a plain overlay would do. */}
        <span
          aria-hidden
          style={{
            ...podiumMask,
            background:
              "linear-gradient(180deg, color-mix(in srgb, var(--brand) 26%, transparent) 0%, color-mix(in srgb, var(--brand) 52%, transparent) 100%)",
            mixBlendMode: "soft-light",
          }}
        />
        {/* DEPTH — and it sits IN the room rather than on top of it. On the dark skins the tinted
            plinth was still a bright slab floating on black, because its own cream is lighter than
            anything else on the page.
            `multiply` against `var(--panel)` fixes that with no polarity branch anywhere, because
            the token does the branching: every LIGHT theme in the catalog sets `--panel` to pure
            white, and multiplying by white is the identity — so this layer is mathematically a
            no-op on Starter, Daylight, Bubblegum and Evergreen. On the dark skins the same
            multiply drags the art down into #16131F / #152238 / #2A1810 / #2A1420 — each room's
            own shadow colour, for free.
            The gradient keeps the TOP untouched, so the podium reads as spotlit from above with its
            base receding into the dark, instead of uniformly dimmed. */}
        <span
          aria-hidden
          style={{
            ...podiumMask,
            background: "linear-gradient(180deg, transparent 14%, var(--panel) 100%)",
            mixBlendMode: "multiply",
            opacity: 0.62,
          }}
        />
        {second && <Winner place={2} entry={second} />}
        {first && <Winner place={1} entry={first} />}
        {third && <Winner place={3} entry={third} />}
      </div>
      {/* names + titles + scores — anchored to the SAME step centres as the avatars (the podium steps
          aren't evenly spaced, so equal thirds would drift out from under the portraits). The columns
          are absolutely positioned, so this height has to RESERVE the tallest one: name (16) + score
          (17) + gaps, plus the title line (11 + gap) when any seat wears one. */}
      <div style={{ position: "relative", height: anyTitle ? 52 : 42, marginTop: 4 }}>
        <NameCol entry={second} place={2} />
        <NameCol entry={first} place={1} />
        <NameCol entry={third} place={3} />
      </div>
    </div>
  );
}

function Winner({ place, entry }: { place: 1 | 2 | 3; entry: LeaderboardRowData }) {
  const s = STEP[place];
  const m = METAL[place];
  const first = place === 1;
  return (
    <div style={{ position: "absolute", left: `${s.x}%`, top: `${s.yBottom}%`, transform: "translate(-50%, -100%)", zIndex: first ? 3 : 2, display: "flex", flexDirection: "column", alignItems: "center" }}>
      {/* Nothing sits above the portrait. Rank is already marked TWICE without help — the podium art
          carries an engraved 1/2/3 on every step face, and the seat heights say it again. A crown
          used to perch on the champion; it competed with the equipped FRAME (the thing the player
          actually earned and chose to wear) for the same few pixels, and it made the one crown
          glyph on this screen ambiguous — the crown next to a score means "points". Now it only
          ever means that. The champion still reads first from the tallest step, the largest glow
          and the gold ring. */}
      <div style={{ position: "relative" }}>
        {first && <span aria-hidden style={{ position: "absolute", inset: -14, borderRadius: "50%", background: "radial-gradient(circle, color-mix(in srgb, var(--amber) 32%, transparent), transparent 66%)", pointerEvents: "none" }} />}
        {/* The player's ACTUAL equipped identity — portrait + equipped frame. A frame REPLACES the
         * tier ring (Avatar prefers `frame` over `ring`), which is correct: the frame is earned
         * merchandise and the placement is already carried by the step. Frameless seats fall back to
         * the podium tier ring; a soft tier glow sits behind either. */}
        <div style={{ position: "relative", borderRadius: "50%", boxShadow: `0 5px 14px ${m.glow}` }}>
          <Avatar
            size={s.size}
            preset={entry.avatar_preset}
            frame={entry.equipped_frame ?? null}
            ring={m.dark}
            animated={first}
          />
        </div>
      </div>
    </div>
  );
}

// Name-column widths, in % of the podium box. Each column is CENTRED on its seat, and the seats sit
// 27% apart (x = 27 / 54 / 81), so adjacent half-widths must sum to under 27 or the boxes overlap:
// 27/2 + 24/2 = 25.5, leaving a 1.5% gutter. The previous 36/32 summed to 34 — a 7% overlap on each
// side, invisible with short names but colliding visibly once a name filled its box. Long names now
// ellipsize inside their own column instead of running into the neighbour's.
const NAME_W = { first: 27, flank: 24 } as const;

function NameCol({ entry, place }: { entry?: LeaderboardRowData; place: 1 | 2 | 3 }) {
  if (!entry) return null;
  const s = STEP[place];
  const first = place === 1;
  const title = getTitle(entry.equipped_title);
  return (
    <div style={{ position: "absolute", left: `${s.x}%`, top: first ? 0 : 2, transform: "translateX(-50%)", width: `${first ? NAME_W.first : NAME_W.flank}%`, display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
      <span
        style={{
          fontFamily: NAME_FONT,
          fontWeight: 700,
          fontSize: first ? 14.5 : 12.5,
          lineHeight: 1.1,
          color: "var(--text)",
          maxWidth: "100%",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {entry.username}
      </span>
      {title && <TitleTag title={title} big={first} />}
      <Score value={entry.score} big={first} />
    </div>
  );
}

/** The equipped TITLE, worn directly under the name — the same flair treatment as the profile menu
 * so a title looks identical wherever it is worn. Earned, never bought (see theme/identity.ts), so
 * it is presented as quiet proof: small, tight, and it takes no vertical room at all when a seat has
 * none equipped (the column just closes up). Gradient flairs are background-clipped to the glyphs by
 * titleFlairStyle; a long title ellipsizes inside its own name column rather than pushing into the
 * neighbouring seat. */
function TitleTag({ title, big = false }: { title: { name: string; flair: string }; big?: boolean }) {
  return (
    // A longer localized title shrinks to fit its ~67px seat column (FitText) instead of ellipsizing
    // to "PODIUM REGU…"; English is untouched.
    <FitText
      as="span"
      size={big ? 9.5 : 8.5}
      min={0.6}
      style={{
        fontFamily: NAME_FONT,
        fontWeight: 900,
        // Sentence case, matching how the title is worn in the profile menu — a title should look
        // the same everywhere it appears. Weight 900 + the flair colour carry the emphasis instead
        // of uppercase (which runs ~15% wider).
        letterSpacing: 0.2,
        lineHeight: 1.15,
        maxWidth: "100%",
        overflow: "hidden",
        whiteSpace: "nowrap",
        ...titleFlairStyle(title.flair),
      }}
    >
      {title.name}
    </FitText>
  );
}

/** One consistent crown + score treatment — the single crown symbol on the screen means "score". */
function Score({ value, big = false }: { value: number; big?: boolean }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4, ...NUM, fontWeight: 700, fontSize: big ? 14 : 12.5, color: "var(--text)" }}>
      <CrownIcon size={big ? 14 : 12} style={{ filter: "drop-shadow(0 1px 1.5px rgba(120,80,0,.3))" }} />
      {value.toLocaleString(activeTag())}
    </span>
  );
}

/* ---------------- Your Rank checkpoint (TODAY'S field only) ---------------- */

function YourRankCard({
  me,
  entered,
  rank,
  score,
  toNext,
  nextRankNum,
  nextPct,
  isChampion,
  t,
}: {
  me: Me;
  entered: boolean;
  rank: number | null;
  score: number;
  toNext: number | null;
  nextRankNum: number | null;
  nextPct: number;
  isChampion: boolean;
  t: Dict;
}) {
  const hasTarget = entered && !isChampion && toNext != null && nextRankNum != null;
  return (
    <div
      style={{
        position: "relative",
        display: "flex",
        alignItems: "center",
        gap: 12,
        borderRadius: 20,
        // The one card on the screen that is deliberately brand-tinted rather than neutral — it is
        // the player's own checkpoint, so it carries the skin's accent in its border, its face and
        // its ambient shadow. All three are mixes INTO the theme's panel, so the tint is the same
        // gentle step above a plain card on every skin instead of Starter's violet everywhere.
        border: "1px solid color-mix(in srgb, var(--brand) 22%, var(--line))",
        background: "linear-gradient(180deg, var(--panel) 0%, color-mix(in srgb, var(--brand) 7%, var(--panel)) 100%)",
        padding: "11px 14px",
        boxShadow:
          "inset 0 1px 0 var(--sheen), 0 2px 6px rgba(17,17,17,.05), 0 14px 30px color-mix(in srgb, var(--brand) 11%, transparent)",
      }}
    >
      {/* rank numeral — today's field, or an em-dash when not yet on the board */}
      <span className="rr-num" style={{ flex: "none", width: 34, textAlign: "center", ...NUM, fontWeight: 800, fontSize: 28, lineHeight: 0.9, color: entered ? "var(--text)" : "var(--faint)" }}>
        {entered ? rank : "—"}
      </span>

      <Avatar size={44} preset={me.avatar_preset} frame={me.equipped_frame} ring="color-mix(in srgb, var(--brand) 45%, transparent)" animated={false} />

      <div style={{ minWidth: 0, flex: 1 }}>
        <FitText as="div" size={9.5} min={0.66} style={{ fontFamily: NAME_FONT, fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase", color: "color-mix(in srgb, var(--brand) 75%, var(--muted))", width: "100%", whiteSpace: "nowrap", overflow: "hidden" }}>
          {t.leaderboard.yourRank}
        </FitText>
        <div style={{ fontFamily: NAME_FONT, fontWeight: 700, fontSize: 16, lineHeight: 1.15, color: "var(--text)" }}>{t.leaderboard.youName}</div>
        {entered ? (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 5, marginTop: 1, ...NUM, fontWeight: 700, fontSize: 13, color: "var(--text)" }}>
            <CrownIcon size={13} style={{ filter: "drop-shadow(0 1px 1.5px rgba(120,80,0,.3))" }} />
            {score.toLocaleString(activeTag())}
          </span>
        ) : (
          <span style={{ fontFamily: NAME_FONT, fontWeight: 600, fontSize: 12, color: "color-mix(in srgb, var(--brand) 68%, var(--muted))" }}>
            {t.leaderboard.playToRank}
          </span>
        )}
      </div>

      {/* Right column only appears when the player is actually IN today's field. */}
      {entered && (
        <div style={{ flex: "none", width: 104, display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 5 }}>
          {hasTarget ? (
            <>
              <span style={{ display: "inline-flex", alignItems: "baseline", gap: 4, ...NUM, color: "var(--text)", fontWeight: 800 }}>
                <span style={{ fontSize: 17, lineHeight: 1 }}>{toNext.toLocaleString(activeTag())}</span>
                <CrownIcon size={11} style={{ transform: "translateY(1px)", filter: "drop-shadow(0 1px 1px rgba(120,80,0,.3))" }} />
              </span>
              <FitText as="span" size={10.5} min={0.66} style={{ fontFamily: NAME_FONT, fontWeight: 600, color: "var(--muted)", ...NUM, maxWidth: "100%", whiteSpace: "nowrap", overflow: "hidden", textAlign: "right" }}>
                {fmt(t.leaderboard.toRank, { rank: nextRankNum })}
              </FitText>
            </>
          ) : (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontFamily: NAME_FONT, fontSize: 12, fontWeight: 700, color: "var(--amber)", maxWidth: "100%", minWidth: 0 }}>
              <CrownIcon size={13} />
              <FitText as="span" size={12} min={0.66} style={{ minWidth: 0, whiteSpace: "nowrap", overflow: "hidden" }}>
                {t.leaderboard.topOfField}
              </FitText>
            </span>
          )}
          <div style={{ width: "100%", height: 6, borderRadius: 999, background: "color-mix(in srgb, var(--brand) 15%, var(--panel2))", overflow: "hidden", boxShadow: "inset 0 1px 1.5px rgba(17,17,17,.08)" }}>
            {/* Same signature gradient as the tab indicator and the primary CTA — one accent surface
                per theme, used everywhere the app means "this is your progress". */}
            <div style={{ width: `${isChampion ? 100 : Math.max(nextPct, 3)}%`, height: "100%", borderRadius: 999, background: "var(--cta)", boxShadow: "0 0 6px color-mix(in srgb, var(--brand) 50%, transparent)" }} />
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------------- Standard rows (ranks 4 → N) ---------------- */

function TopRow({ row, first }: { row: LeaderboardRowData; first: boolean }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "9px 0",
        // Divider aligns to the name column, not the full card width.
        borderTop: first ? "none" : "1px solid color-mix(in srgb, var(--line) 80%, transparent)",
      }}
    >
      <span style={{ width: 20, flex: "none", textAlign: "center", ...NUM, fontWeight: 700, fontSize: 14, color: "var(--muted)" }}>
        {row.rank}
      </span>
      <Avatar size={34} preset={row.avatar_preset} frame={row.equipped_frame} animated={false} />
      <span style={{ flex: 1, minWidth: 0, fontFamily: NAME_FONT, fontWeight: 700, fontSize: 15, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {row.username}
      </span>
      <span style={{ display: "inline-flex", alignItems: "center", gap: 5, flex: "none", ...NUM, fontWeight: 700, fontSize: 14, color: "var(--text)" }}>
        <CrownIcon size={13} style={{ filter: "drop-shadow(0 1px 1.5px rgba(120,80,0,.28))" }} />
        {row.score.toLocaleString(activeTag())}
      </span>
    </div>
  );
}

/* ---------------- bits ---------------- */

function Centered({ children }: { children: React.ReactNode }) {
  return <div style={{ padding: "40px 20px", textAlign: "center", color: "var(--muted)", fontWeight: 600, fontSize: 14 }}>{children}</div>;
}

function GlobeIcon({ active }: { active: boolean }) {
  return (
    <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 2 : 1.8} aria-hidden style={{ opacity: active ? 1 : 0.8 }}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M3.5 12h17M12 3.5c2.5 2.4 2.5 14.6 0 17M12 3.5c-2.5 2.4-2.5 14.6 0 17" strokeLinecap="round" />
    </svg>
  );
}

function FriendsIcon({ active }: { active: boolean }) {
  return (
    <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 2 : 1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden style={{ opacity: active ? 1 : 0.8 }}>
      <circle cx="9" cy="8" r="3.2" />
      <path d="M3.5 19c.4-3 2.7-5 5.5-5s5.1 2 5.5 5" />
      <path d="M16 5.4a3 3 0 0 1 0 5.2M17.5 19c-.2-2-1-3.6-2.4-4.6" />
    </svg>
  );
}
