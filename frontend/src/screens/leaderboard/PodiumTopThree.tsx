import championAura from "@/assets/leaderboard/champion-aura.webp";
import { lobbyArt } from "@/assets/lobby";
import { FitText } from "@/ui/FitText";
import { getTitle, titleFlairStyle } from "@/theme/identity";
import type { LeaderboardRowData } from "./LeaderboardRow";
import { podiumAvatar } from "./podiumAvatars";
import { activeTag } from "@/i18n/format";

// One-object podium stage (≤190px tall). The champion (#1) dominates: centered, tallest, gold border
// + a CONTROLLED gold glow, crown overlapping its avatar. #2 (silver) and #3 (bronze) are calm —
// soft shadow only, no colored glow — and tuck behind the champion on a shared CSS platform.
// Portraits come from the avatar registry (hooded = champion/you, bot = others); titles ride under.
type Place = 1 | 2 | 3;

const TREATMENT: Record<Place, { ring: string; border: string; glow: string; cardBg: string; medal: string; medalFg: string; score: string }> = {
  1: {
    ring: "color-mix(in srgb, var(--amber) 70%, transparent)",
    border: "2px solid color-mix(in srgb, var(--amber) 65%, transparent)",
    glow: "0 10px 26px rgba(0,0,0,.5), 0 0 18px color-mix(in srgb, var(--amber) 26%, transparent), inset 0 1px 0 rgba(255,255,255,.1)",
    cardBg: "linear-gradient(180deg, color-mix(in srgb, var(--amber) 15%, var(--panel2)) 0%, var(--panel) 100%)",
    medal: "linear-gradient(135deg, #ffe680, #f59e0b)",
    medalFg: "#3a1c04",
    score: "var(--amber)",
  },
  2: {
    ring: "color-mix(in srgb, #c7bdf0 40%, transparent)",
    border: "1px solid color-mix(in srgb, var(--line) 80%, transparent)",
    glow: "0 5px 14px rgba(0,0,0,.5)",
    // Darker than the champion so the eye goes to #1.
    cardBg: "linear-gradient(180deg, color-mix(in srgb, var(--panel) 88%, black) 0%, color-mix(in srgb, var(--panel) 96%, black) 100%)",
    medal: "linear-gradient(135deg, #d7ccff, #a994d9)",
    medalFg: "#241044",
    score: "var(--muted)",
  },
  3: {
    ring: "color-mix(in srgb, #d68a4a 38%, transparent)",
    border: "1px solid color-mix(in srgb, #d68a4a 22%, var(--line))",
    glow: "0 5px 14px rgba(0,0,0,.5)",
    cardBg: "linear-gradient(180deg, color-mix(in srgb, #8a4f22 14%, color-mix(in srgb, var(--panel) 88%, black)) 0%, color-mix(in srgb, var(--panel) 96%, black) 100%)",
    medal: "linear-gradient(135deg, #d28b4a, #b9793d)",
    medalFg: "#1a0a00",
    score: "color-mix(in srgb, #e6a566 70%, var(--muted))",
  },
};

function Portrait({ entry, place, size }: { entry: LeaderboardRowData | undefined; place: Place; size: number }) {
  const av = entry
    ? podiumAvatar({ seed: entry.username, isMe: entry.isMe, champion: place === 1 })
    : ({ src: lobbyArt.avatarBot, kind: "bot" } as const);
  const ring = entry?.isMe ? "var(--amber)" : TREATMENT[place].ring;
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        flex: "none",
        display: "grid",
        placeItems: "center",
        background: "radial-gradient(circle at 50% 36%, color-mix(in srgb, var(--panel2) 88%, white 8%), var(--panel))",
        border: `${place === 1 ? 3 : 2}px solid ${ring}`,
        boxShadow: place === 1 ? "0 4px 12px rgba(0,0,0,.5), 0 0 14px color-mix(in srgb, var(--amber) 40%, transparent)" : "0 4px 10px rgba(0,0,0,.45)",
        overflow: "hidden",
      }}
    >
      <img
        src={av.src}
        alt=""
        aria-hidden
        data-portrait={av.kind}
        draggable={false}
        style={{ width: size - 8, height: size - 8, objectFit: "contain", display: "block", opacity: entry ? 1 : 0.5 }}
      />
    </div>
  );
}

function ChampionCard({ entry, youLabel }: { entry: LeaderboardRowData | undefined; youLabel: string }) {
  const isEmpty = !entry;
  const title = getTitle(entry?.equipped_title);
  const tr = TREATMENT[1];
  return (
    <div style={{ position: "relative", zIndex: 3, width: "47%", maxWidth: 185 }}>
      {/* Crown overlaps the card's top edge (absolute → adds no layout height of its own). */}
      {!isEmpty && (
        <img
          src={lobbyArt.crownHero}
          alt=""
          aria-hidden
          draggable={false}
          style={{
            position: "absolute",
            top: -26,
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 2,
            width: 52,
            height: 52,
            objectFit: "contain",
            filter: "drop-shadow(0 5px 16px rgba(255,193,52,.8))",
          }}
        />
      )}
      <div
        style={{
          position: "relative",
          borderRadius: 18,
          minHeight: 136,
          padding: "18px 6px 9px",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 2,
          background: tr.cardBg,
          border: tr.border,
          boxShadow: tr.glow,
        }}
      >
        {/* Champion aura — gold ray-burst PNG (true transparency) centered behind the #1 avatar.
         * z-index 0 keeps it behind the avatar + text (which sit in the z-1 content layer below);
         * stable low opacity so it never overpowers the name/score. */}
        {!isEmpty && (
          <img
            src={championAura}
            alt=""
            aria-hidden
            draggable={false}
            data-aura="winner"
            style={{
              position: "absolute",
              top: -38,
              left: "50%",
              transform: "translateX(-50%)",
              width: 162,
              height: "auto",
              opacity: 0.5,
              zIndex: 0,
              pointerEvents: "none",
            }}
          />
        )}
        <div style={{ position: "relative", zIndex: 1, width: "100%", display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
          <Portrait entry={entry} place={1} size={70} />
          <MedalBadge place={1} />
          {isEmpty ? (
            <span style={{ fontSize: 11, color: "var(--faint)", fontStyle: "italic" }}>—</span>
          ) : (
            <>
              <Name text={entry.isMe ? youLabel : entry.username} isMe={entry.isMe} big />
              {title && <TitleTag title={title} big />}
              <ScoreRow value={entry.score} color={tr.score} big />
            </>
          )}
        </div>
      </div>
      {/* Glowing pedestal directly under the champion — lifts #1 off the shared stage. */}
      {!isEmpty && (
        <div
          aria-hidden
          style={{
            position: "absolute",
            bottom: -7,
            left: "50%",
            transform: "translateX(-50%)",
            width: "94%",
            height: 22,
            borderRadius: "50%",
            background: "radial-gradient(ellipse at center, color-mix(in srgb, var(--amber) 48%, transparent), transparent 70%)",
            filter: "blur(3px)",
            zIndex: -1,
            pointerEvents: "none",
          }}
        />
      )}
    </div>
  );
}

function SideCard({ entry, place, youLabel }: { entry: LeaderboardRowData | undefined; place: 2 | 3; youLabel: string }) {
  const isEmpty = !entry;
  const title = getTitle(entry?.equipped_title);
  const tr = TREATMENT[place];
  const tuck = place === 2 ? { marginRight: "-11%" } : { marginLeft: "-11%" };
  return (
    <div style={{ position: "relative", zIndex: 1, width: "37%", maxWidth: 146, ...tuck }}>
      <div
        style={{
          borderRadius: 16,
          minHeight: 116,
          padding: "11px 6px 9px",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 2,
          background: tr.cardBg,
          border: tr.border,
          boxShadow: tr.glow,
        }}
      >
        <Portrait entry={entry} place={place} size={46} />
        <MedalBadge place={place} />
        {isEmpty ? (
          <span style={{ fontSize: 11, color: "var(--faint)", fontStyle: "italic" }}>—</span>
        ) : (
          <>
            <Name text={entry.isMe ? youLabel : entry.username} isMe={entry.isMe} />
            {title && <TitleTag title={title} />}
            <ScoreRow value={entry.score} color={tr.score} />
          </>
        )}
      </div>
    </div>
  );
}

function MedalBadge({ place }: { place: Place }) {
  const tr = TREATMENT[place];
  return (
    <div
      aria-hidden
      style={{
        width: place === 1 ? 22 : 19,
        height: place === 1 ? 22 : 19,
        borderRadius: "50%",
        display: "grid",
        placeItems: "center",
        fontWeight: 900,
        fontSize: place === 1 ? 12 : 10.5,
        fontFamily: "Fredoka, sans-serif",
        background: tr.medal,
        color: tr.medalFg,
        boxShadow: "0 2px 5px rgba(0,0,0,.45)",
        marginTop: -1,
      }}
    >
      {place}
    </div>
  );
}

function Name({ text, isMe, big = false }: { text: string; isMe?: boolean; big?: boolean }) {
  return (
    <span
      style={{
        fontSize: big ? 14 : 11.5,
        fontWeight: 800,
        fontFamily: "Fredoka, sans-serif",
        color: isMe ? "var(--amber)" : "var(--text)",
        textAlign: "center",
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
        maxWidth: "100%",
        padding: "0 4px",
      }}
    >
      {text}
    </span>
  );
}

function TitleTag({ title, big = false }: { title: { name: string; flair: string }; big?: boolean }) {
  return (
    <FitText
      as="span"
      size={big ? 9.5 : 8.5}
      min={0.66}
      style={{
        fontWeight: 900,
        letterSpacing: 0.3,
        overflow: "hidden",
        whiteSpace: "nowrap",
        maxWidth: "100%",
        padding: "0 4px",
        ...titleFlairStyle(title.flair),
      }}
    >
      {title.name}
    </FitText>
  );
}

function ScoreRow({ value, color, big = false }: { value: number; color: string; big?: boolean }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4, marginTop: 1 }}>
      <svg viewBox="0 0 24 24" style={{ width: big ? 14 : 10, height: big ? 14 : 10 }} fill={color} aria-hidden>
        <path d="M12 2l2.9 6.1 6.6.9-4.8 4.6 1.2 6.6L12 17.8 6.1 20.8l1.2-6.6L2.5 9l6.6-.9z" />
      </svg>
      <span className="display" style={{ fontSize: big ? 21 : 12, color, lineHeight: 1, textShadow: big ? "0 0 14px color-mix(in srgb, var(--amber) 55%, transparent)" : undefined }}>
        {value.toLocaleString(activeTag())}
      </span>
    </span>
  );
}

export function PodiumTopThree({
  entries,
  youLabel,
}: {
  entries: LeaderboardRowData[];
  youLabel: string;
}) {
  const byPlace = Object.fromEntries(entries.slice(0, 3).map((e, i) => [i + 1, e])) as Record<
    number,
    LeaderboardRowData | undefined
  >;

  return (
    <div style={{ position: "relative", paddingTop: 18, overflow: "visible" }}>
      {/* Shared stage / platform the top 3 stand on. */}
      <div
        aria-hidden
        style={{
          position: "absolute",
          left: "5%",
          right: "5%",
          bottom: 2,
          height: 26,
          borderRadius: "50% / 100%",
          background: "linear-gradient(180deg, color-mix(in srgb, var(--brand) 30%, var(--panel2)), color-mix(in srgb, var(--panel) 92%, black))",
          border: "1px solid color-mix(in srgb, var(--brand-2) 24%, transparent)",
          boxShadow: "0 12px 24px rgba(0,0,0,.5), inset 0 2px 0 rgba(255,255,255,.06)",
          pointerEvents: "none",
        }}
      />
      <div style={{ position: "relative", display: "flex", alignItems: "flex-end", justifyContent: "center", padding: "0 2px 10px" }}>
        <SideCard entry={byPlace[2]} place={2} youLabel={youLabel} />
        <ChampionCard entry={byPlace[1]} youLabel={youLabel} />
        <SideCard entry={byPlace[3]} place={3} youLabel={youLabel} />
      </div>
    </div>
  );
}
