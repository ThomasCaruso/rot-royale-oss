import { useCallback, useEffect, useState } from "react";
import { api, type HistoryItem } from "@/api/client";
import { fmt, useT } from "@/i18n/useT";
import { royaleTitleKey } from "@/lib/home";
import {
  buildShareText,
  type FieldRow,
  formatSignedDelta,
  gameTitle,
  getPlacementTier,
} from "@/lib/results";
import { formatLocalDate } from "@/lib/time";
import {
  haptic,
  isSfxEnabled,
  placementImpact,
  podiumFanfare,
  ratingRise,
  resumeAudio,
  scoreImpact,
  setSfxEnabled,
  uiTap,
} from "@/lib/sfx";
import { AddFriendButton } from "@/screens/friends/AddFriendButton";
import type { Me } from "@/store/session";
import { CountUp } from "@/ui/CountUp";
import { FitText } from "@/ui/FitText";
import { useReducedMotion } from "@/ui/useReducedMotion";
import { activeTag } from "@/i18n/format";

// A quiet reveal: 0 calculating · 1 hero (score + placement) · 2 the rest (rating, standings, CTAs).
const FINAL_STAGE = 2;
const STAGE_DELAYS = [650, 1300];

const contentWrap: React.CSSProperties = {
  width: "100%",
  maxWidth: 420,
  margin: "0 auto",
  padding:
    "calc(clamp(24px, 6vh, 52px) + env(safe-area-inset-top)) clamp(24px, 7vw, 28px) calc(36px + env(safe-area-inset-bottom))",
  display: "flex",
  flexDirection: "column",
  gap: "clamp(24px, 6vw, 34px)",
};

const eyebrow: React.CSSProperties = {
  fontSize: 11,
  letterSpacing: "0.2em",
  textTransform: "uppercase",
  fontWeight: 700,
  color: "var(--brand)",
};

const statLabel: React.CSSProperties = {
  fontSize: 10.5,
  letterSpacing: "0.15em",
  textTransform: "uppercase",
  fontWeight: 700,
  color: "var(--muted)",
};

/**
 * The settled-result reveal — a quiet, editorial results report (mono/blank_light skin). It opens to
 * a minimal PRE-REVEAL CURTAIN whose "Reveal Results" tap starts the reveal (and unlocks audio under
 * autoplay policy). All copy is field-framed; coins-not-cash; never claims the bot-padded field is
 * human.
 */
export function RoyaleResultsModal({
  result,
  me,
  onClose,
  onPractice,
}: {
  result: HistoryItem;
  me: Me;
  onClose: () => void;
  onPractice: () => void;
  /** Kept for call-site compatibility; the quiet report no longer surfaces a "tomorrow unlocks" line
   * (the Home screen owns the next-open countdown). */
  nextOpenAt?: string | null;
}) {
  const t = useT();
  const reduced = useReducedMotion();
  const [revealed, setRevealed] = useState(false);
  const [stage, setStage] = useState(0);
  const [field, setField] = useState<FieldRow[] | null>(null); // null = loading, [] = none/failed
  const [shared, setShared] = useState(false);
  // The `…/c/<id>` share link, minted ahead of the tap. It MUST be resolved before the user
  // presses Share: `navigator.share()` requires a live user gesture, and awaiting anything inside
  // the handler forfeits that on iOS Safari — the share sheet simply never opens. Null = not ready
  // (or unavailable), in which case sharing degrades to the brag text alone rather than blocking.
  const [challengeUrl, setChallengeUrl] = useState<string | null>(null);
  // Handles already connected to me (friends + pending either way). Offering "add" on someone you
  // already added reads as broken, so the button is withheld for them. Null until known — we'd
  // rather show no button for a beat than show a wrong one.
  const [connected, setConnected] = useState<Set<string> | null>(null);
  const [muted, setMuted] = useState(() => !isSfxEnabled());

  const place = result.place ?? null;
  const tier = getPlacementTier(place ?? 999);

  // The staged sequence starts ONLY after "Reveal Results" (the gesture that unlocked audio).
  useEffect(() => {
    if (!revealed) return;
    if (reduced) {
      setStage(FINAL_STAGE);
      return;
    }
    const timers = STAGE_DELAYS.map((d, i) => window.setTimeout(() => setStage(i + 1), d));
    return () => timers.forEach((tm) => window.clearTimeout(tm));
  }, [revealed, reduced]);

  // Restrained sound + haptics on each reveal beat (silent no-op if audio is blocked / muted).
  useEffect(() => {
    if (!revealed || reduced) return;
    if (stage === 1) {
      scoreImpact();
      placementImpact();
      haptic(tier === "normal" ? 20 : [20, 35, 20]);
      if (tier !== "normal") window.setTimeout(() => podiumFanfare(), 180);
    } else if (stage === 2) {
      ratingRise();
    }
  }, [stage, revealed, reduced, tier]);

  // Preload the field (real entries + cold-start bots — same source as the lobby leaderboard) while
  // the curtain is up. Honest: bots populate it, never labelled human.
  useEffect(() => {
    let cancelled = false;
    api
      .windowField(result.window_id)
      .then((f) => {
        if (cancelled) return;
        setField(
          f.entries.map((e) => ({
            username: e.username,
            score: e.points.reduce((a, b) => a + b, 0),
            isMe: e.username === me.username,
          })),
        );
      })
      .catch(() => !cancelled && setField([]));
    return () => {
      cancelled = true;
    };
  }, [result.window_id, me.username]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Who am I already connected to? Best-effort: on failure `connected` stays null and no add
  // buttons render, which is the safe direction to fail in.
  useEffect(() => {
    let alive = true;
    api
      .friends()
      .then((r) => {
        if (!alive) return;
        const names = [
          ...r.friends.map((f) => f.username),
          ...r.incoming.map((x) => x.username),
          ...r.outgoing.map((x) => x.username),
        ].map((n) => n.toLowerCase());
        setConnected(new Set(names));
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  // Mint the share link as soon as the results open. `HistoryItem` carries only `window_id`, so we
  // resolve the entry first; `createChallenge` is idempotent per entry, so re-opening the results
  // returns the SAME link rather than minting a new one. Entirely best-effort — every failure path
  // leaves `challengeUrl` null and sharing still works, just without the link.
  useEffect(() => {
    let alive = true;
    api
      .myEntry(result.window_id)
      .then(({ entry_id }) => (entry_id ? api.createChallenge(entry_id) : null))
      .then((challenge) => {
        if (alive && challenge) setChallengeUrl(challenge.url);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [result.window_id]);

  const startReveal = useCallback(() => {
    resumeAudio(); // a tap unlocks audio under autoplay policy
    uiTap();
    setRevealed(true);
    if (reduced) {
      placementImpact();
      haptic(tier === "normal" ? 20 : [20, 35, 20]);
      if (tier !== "normal") window.setTimeout(() => podiumFanfare(), 160);
    }
  }, [reduced, tier]);

  const share = useCallback(() => {
    const title = gameTitle(result.slot);
    const st = buildShareText(place, result.field_size ?? 1);
    const brag =
      st.key === "shareBanked"
        ? fmt(t.results.shareBanked, { title })
        : st.key === "shareTopped"
          ? fmt(t.results.shareTopped, { title })
          : fmt(t.results.sharePlaced, { rank: st.rank, fieldSize: st.fieldSize, title });
    // Without the link this is a brag with nothing to tap — the recipient has no way into the
    // game, and the whole share loop (OG card → landing → guest play) is unreachable. Append the
    // same recruit line the Rot Report uses so both surfaces read alike.
    const text = challengeUrl
      ? `${brag}\n\n${fmt(t.rotReport.shareTagline, { link: challengeUrl })}`
      : brag;
    if (navigator.share) {
      // `url` is what the OS turns into a rich preview; the text carries it too for targets that
      // drop the url field (SMS, some Android apps).
      void navigator
        .share(challengeUrl ? { text, url: challengeUrl } : { text })
        .catch(() => {});
    } else if (navigator.clipboard) {
      void navigator.clipboard.writeText(text).then(() => setShared(true));
    }
  }, [result.slot, result.field_size, place, t, challengeUrl]);

  const toggleMute = useCallback(() => {
    setMuted((m) => {
      const next = !m;
      setSfxEnabled(!next);
      if (!next) {
        resumeAudio();
        uiTap();
      }
      return next;
    });
  }, []);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t.results.dialogLabel}
      onClick={() => revealed && stage < FINAL_STAGE && setStage(FINAL_STAGE)}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 100,
        background: "var(--bg)",
        overflowY: "auto",
        WebkitOverflowScrolling: "touch",
      }}
    >
      <button
        type="button"
        aria-label={t.results.closeLabel}
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
        style={cornerBtn("right")}
      >
        <span style={{ color: "var(--muted)", fontSize: 17, fontWeight: 700 }}>✕</span>
      </button>
      <button
        type="button"
        aria-label={muted ? t.results.unmute : t.results.mute}
        aria-pressed={muted}
        onClick={(e) => {
          e.stopPropagation();
          toggleMute();
        }}
        style={cornerBtn("left")}
      >
        <span aria-hidden className="emoji" style={{ fontSize: 15 }}>
          {muted ? "🔇" : "🔊"}
        </span>
      </button>

      <div onClick={(e) => e.stopPropagation()} style={contentWrap}>
        {!revealed ? (
          <PreRevealCurtain onReveal={startReveal} onClose={onClose} />
        ) : (
          <ResultReveal
            stage={stage}
            result={result}
            me={me}
            field={field}
            onClose={onClose}
            onPractice={onPractice}
            onShare={share}
            shared={shared}
            connected={connected}
          />
        )}
      </div>
    </div>
  );
}

function cornerBtn(side: "left" | "right"): React.CSSProperties {
  return {
    position: "fixed",
    top: "calc(16px + env(safe-area-inset-top))",
    [side]: 16,
    zIndex: 110,
    width: 34,
    height: 34,
    borderRadius: "50%",
    border: "1px solid var(--line)",
    background: "transparent",
    display: "grid",
    placeItems: "center",
    cursor: "pointer",
  };
}

/** The anticipation moment: results are ready, but the reveal (and its sound) waits for a tap. Quiet
 * and editorial — no crown, no gold, no gradient. */
export function PreRevealCurtain({
  onReveal,
  onClose,
}: {
  onReveal: () => void;
  onClose: () => void;
}) {
  const t = useT();
  return (
    <div
      style={{
        textAlign: "center",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 14,
        paddingTop: "16vh",
      }}
    >
      <div style={eyebrow}>{t.results.curtainEyebrow}</div>
      <div
        className="display"
        style={{ fontSize: "clamp(28px, 8.5vw, 38px)", lineHeight: 1.1, color: "var(--text)" }}
      >
        {t.results.curtainTitle}
      </div>
      <div style={{ color: "var(--muted)", fontSize: 14, fontWeight: 500, maxWidth: 300 }}>
        {t.results.curtainHint}
      </div>
      <div style={{ width: "100%", maxWidth: 300, marginTop: 12 }}>
        <PrimaryButton onClick={onReveal}>{t.results.reveal}</PrimaryButton>
        <div style={{ display: "flex", justifyContent: "center", marginTop: 14 }}>
          <TextButton onClick={onClose}>{t.common.backToHub}</TextButton>
        </div>
      </div>
    </div>
  );
}

/** The quiet result report: header · hero (score + placement) · secondary stats · standings · CTAs.
 * Driven by `stage`; pure given its props, so it renders + asserts directly in tests. */
export function ResultReveal({
  stage,
  result,
  me,
  field,
  onClose,
  onPractice,
  onShare,
  shared,
  connected = null,
}: {
  stage: number;
  result: HistoryItem;
  me: Me;
  field: FieldRow[] | null;
  onClose: () => void;
  onPractice: () => void;
  onShare: () => void;
  shared: boolean;
  /** Lowercased handles already connected to me; null while unknown (add buttons stay hidden). */
  connected?: Set<string> | null;
}) {
  const t = useT();
  const place = result.place ?? null;
  const fieldSize = result.field_size ?? 1;
  const score = result.total_score ?? 0;
  const ratingBefore = result.rating_before;
  const ratingAfter = result.rating_after;
  const ratingDelta =
    ratingBefore != null && ratingAfter != null ? ratingAfter - ratingBefore : null;

  // Legacy-aware LOCALIZED title: "royale" → Daily Royale, legacy → "Legacy * Game". A legacy result
  // NEVER reads as Daily Royale.
  const title = t.home[royaleTitleKey(result.slot)];
  const dateLabel = formatLocalDate(result.contest_date);
  const canShare =
    typeof navigator !== "undefined" && Boolean(navigator.share ?? navigator.clipboard);

  return (
    <>
      {/* Header */}
      <div style={{ textAlign: "center", display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={eyebrow}>{dateLabel}</div>
        <div className="display" style={{ fontSize: "clamp(30px, 9vw, 42px)", color: "var(--text)" }}>
          {title}
        </div>
        <div style={{ color: "var(--muted)", fontSize: 13.5, fontWeight: 500, minHeight: 18 }}>
          {stage === 0 ? t.results.calculating : t.results.finalIn}
        </div>
      </div>

      {stage >= 1 && (
        <>
          {/* Hero — the score, then the placement, in one open, cardless area. */}
          <div style={{ textAlign: "center", display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={statLabel}>{t.results.score}</div>
            <div
              className="display"
              style={{ fontSize: "clamp(60px, 20vw, 96px)", lineHeight: 1, color: "var(--text)" }}
            >
              <CountUp value={score} />
            </div>
            <div
              style={{
                width: 40,
                height: 1,
                background: "color-mix(in srgb, var(--brand) 45%, transparent)",
                margin: "18px auto 0",
              }}
            />
            <div
              className="display"
              style={{ fontSize: "clamp(34px, 11vw, 52px)", lineHeight: 1, color: "var(--text)", marginTop: 18 }}
            >
              {place != null ? `#${place}` : t.results.resultRecorded}
            </div>
            <div style={{ color: "var(--muted)", fontSize: 13.5, fontWeight: 500 }}>
              {place != null
                ? fieldSize <= 1
                  ? t.results.firstInField
                  : fmt(t.results.placementSub, { place, fieldSize })
                : t.results.recorded}
            </div>
          </div>
        </>
      )}

      {stage >= FINAL_STAGE && (
        <>
          {/* Rating summary — a compact 3-column strip, framed by hairlines. No cards. */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr 1fr",
              borderTop: "1px solid var(--line)",
              borderBottom: "1px solid var(--line)",
            }}
          >
            <SummaryCol
              label={t.results.ratingChange}
              value={
                ratingDelta == null ? (
                  "—"
                ) : ratingDelta === 0 ? (
                  <span style={{ color: "var(--muted)" }}>{t.results.noChange}</span>
                ) : (
                  <span style={{ color: ratingDelta > 0 ? "var(--text)" : "var(--pink)" }}>
                    {formatSignedDelta(ratingDelta)}
                  </span>
                )
              }
            />
            <SummaryCol
              divider
              label={t.results.rating}
              value={(ratingAfter ?? me.rating).toLocaleString(activeTag())}
            />
            <SummaryCol
              divider
              label={t.results.divisionLabel}
              value={<span style={{ textTransform: "capitalize" }}>{me.division ?? "—"}</span>}
            />
          </div>

          {/* Final standings — flat text rows, top-3 + you, a soft highlight on your row. */}
          <MiniLeaderboard
            field={field}
            fallbackMe={{ username: me.username, score, place }}
            connected={connected}
          />

          {/* Actions — one dominant CTA, two quiet text actions. */}
          <div>
            <PrimaryButton onClick={onClose}>{t.common.backToHub}</PrimaryButton>
            <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: 22, marginTop: 16 }}>
              <TextButton onClick={onPractice}>{t.results.practice}</TextButton>
              {canShare && (
                <>
                  <span aria-hidden style={{ width: 1, height: 12, background: "var(--line)" }} />
                  <TextButton onClick={onShare}>{shared ? t.results.copied : t.results.share}</TextButton>
                </>
              )}
            </div>
          </div>
        </>
      )}
    </>
  );
}

/** One cell of the compact 3-column rating summary — small label over a near-black value, with a
 * hairline divider on its left (all but the first). */
function SummaryCol({
  label,
  value,
  divider,
}: {
  label: string;
  value: React.ReactNode;
  divider?: boolean;
}) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 6,
        padding: "16px 6px",
        borderLeft: divider ? "1px solid var(--line)" : "none",
      }}
    >
      {/* A longer localized column label shrinks to hold one line (FitText) so the three columns
          stay aligned rather than one wrapping and pushing its value down. */}
      <FitText as="span" size={9.5} min={0.66} style={{ letterSpacing: "0.11em", textTransform: "uppercase", fontWeight: 700, color: "var(--muted)", textAlign: "center", width: "100%", whiteSpace: "nowrap", overflow: "hidden" }}>
        {label}
      </FitText>
      <span style={{ fontSize: 17, fontWeight: 700, color: "var(--text)", fontVariantNumeric: "tabular-nums" }}>
        {value}
      </span>
    </div>
  );
}

/** Primary CTA — a sleek near-black pill (the mono theme's --cta), full width. */
function PrimaryButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        width: "100%",
        height: 52,
        borderRadius: 14,
        border: "none",
        background: "var(--cta)",
        color: "var(--ctaText)",
        fontFamily: "var(--font-display)",
        fontSize: 16,
        fontWeight: 700,
        letterSpacing: "0.01em",
        cursor: "pointer",
      }}
    >
      {children}
    </button>
  );
}

/** Understated secondary action — text only, muted. */
function TextButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        background: "none",
        border: "none",
        padding: "4px 2px",
        color: "var(--muted)",
        fontSize: 14,
        fontWeight: 600,
        cursor: "pointer",
      }}
    >
      {children}
    </button>
  );
}

/** Top-3 of the field + the player's own row — flat, text-only, no rank pills or avatars. The
 * player's row gets a soft ivory highlight, not a heavy bordered card. */
function MiniLeaderboard({
  field,
  fallbackMe,
  connected,
}: {
  field: FieldRow[] | null;
  fallbackMe: { username: string; score: number; place: number | null };
  /** Lowercased handles already connected to me; null while unknown (no buttons shown). */
  connected: Set<string> | null;
}) {
  const t = useT();
  if (field === null) {
    return <div style={{ ...statLabel, textAlign: "center" }}>{t.results.loadingField}</div>;
  }
  const sorted = [...field].sort((a, b) => b.score - a.score);
  const top3 = sorted.slice(0, 3);
  const meIdx = sorted.findIndex((r) => r.isMe);
  const meRow = meIdx >= 0 ? { rank: meIdx + 1, row: sorted[meIdx] } : null;

  // No field data (failed fetch) → still show the player's own result row.
  const rows =
    top3.length > 0
      ? top3.map((row, i) => ({ rank: i + 1, row }))
      : fallbackMe.place != null
        ? [{ rank: fallbackMe.place, row: { username: fallbackMe.username, score: fallbackMe.score, isMe: true } }]
        : [];

  const showMeSeparately = meRow != null && meRow.rank > 3;

  return (
    <div>
      <div style={{ ...statLabel, marginBottom: 4 }}>{t.results.finalStandings}</div>
      {rows.map(({ rank, row }, i) => (
        <LbRow
          key={`t${rank}`}
          rank={rank}
          row={row}
          first={i === 0}
          addable={connected != null && !connected.has(row.username.toLowerCase())}
        />
      ))}
      {showMeSeparately && (
        <>
          <div style={{ textAlign: "center", color: "var(--faint)", fontSize: 13, padding: "2px 0" }}>···</div>
          <LbRow rank={meRow.rank} row={meRow.row} first />
        </>
      )}
    </div>
  );
}

function LbRow({
  rank,
  row,
  first,
  addable,
}: {
  rank: number;
  row: FieldRow;
  first: boolean;
  /** Existing friends are excluded upstream, so an add button here always has somewhere to go. */
  addable?: boolean;
}) {
  const t = useT();
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 14,
        padding: "12px 12px",
        margin: "0 -12px",
        borderTop: first ? "none" : "1px solid var(--line)",
        borderRadius: row.isMe ? 10 : 0,
        // Soft highlight on the player's own row — a faint wash, not a bordered card.
        background: row.isMe ? "color-mix(in srgb, var(--brand) 7%, transparent)" : "transparent",
      }}
    >
      <span
        style={{
          width: 16,
          fontSize: 13,
          fontWeight: 600,
          color: "var(--faint)",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {rank}
      </span>
      <span
        style={{
          flex: 1,
          minWidth: 0,
          fontSize: 15,
          fontWeight: row.isMe ? 700 : 500,
          color: "var(--text)",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {row.isMe ? t.results.you : row.username}
      </span>
      <span
        style={{
          fontSize: 15,
          fontWeight: 700,
          color: "var(--text)",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {row.score.toLocaleString(activeTag())}
      </span>
      {/* The whole point: you just went up against this person, so acting on that shouldn't
          require memorising their handle and typing it into another screen. Reserve the slot even
          when there's no button, so scores stay in one column down the card. */}
      <span style={{ flex: "none", width: 30, display: "flex", justifyContent: "flex-end" }}>
        {addable && !row.isMe ? <AddFriendButton username={row.username} /> : null}
      </span>
    </div>
  );
}
