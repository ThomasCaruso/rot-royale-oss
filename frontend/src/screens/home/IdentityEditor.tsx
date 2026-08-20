import { useEffect, useRef, useState } from "react";
import { api, type IdentityItem, type IdentityResponse } from "@/api/client";
import type { Dict } from "@/i18n";
import { fmt, useT } from "@/i18n/useT";
import { Avatar } from "@/screens/home/Avatar";
import { useSessionStore } from "@/store/session";
import {
  AVATAR_PRESETS,
  getBadge,
  getTitle,
  titleFlairStyle,
} from "@/theme/identity";
import { Display } from "@/ui/Display";

/**
 * Identity editor — the AvatarPicker grown into a tabbed trophy case (Avatar | Badges | Title),
 * same springy bottom sheet, opened from ProfileMenu's "Edit identity" row.
 *
 *  - Avatar tab: the original 8-preset grid, behavior unchanged (pick → PATCH /me/avatar →
 *    store patched from the SERVER response → one rr-pop beat → close).
 *  - Badges tab: all 10 honors from GET /identity. Earned+equipped glow gold (tap to take down),
 *    earned+unequipped are tappable while fewer than 3 are pinned — a 4th tap gets a gentle
 *    shake and NEVER reaches the API (client-side guard; the server enforces too). Locked badges
 *    stay beautiful: tinted disc dimmed + goal-framed copy (anticipation, not a dead end).
 *  - Title tab: the 6 earned titles plus "No title". One equippable; each name previews its
 *    flair. Locked titles dim with goal copy.
 *
 * Server-authoritative throughout (mirrors VaultScreen/AvatarPicker discipline): every mutation
 * is busy-guarded, post-await setState is gated on mountedRef, the store is patched ONLY from
 * the PATCH response, and any error silently refetches /identity + /me so the UI snaps back to
 * server truth. Pick order for badges comes from me.equipped_badges (the server's ordered list);
 * GET /identity supplies earned state. Rendered above the ProfileMenu (z 80/90).
 */
type EditorTab = "avatar" | "badges" | "title";

const CLOSE_BEAT_MS = 260; // long enough for rr-pop (.4s collapses fine), short enough to feel snappy
const SHAKE_MS = 500; // rr-shake runs .45s; clear just after so a re-tap can re-trigger it
const MAX_BADGES = 3;

/** Which world a medal badge points at — drives the locked goal copy. */
const MEDAL_WORLDS: Record<string, string> = {
  medal_science: "Science",
  medal_history: "History",
  medal_geography: "Geography",
  medal_arts: "Arts",
  medal_sports: "Sports",
  medal_pop: "Pop Culture",
};

/** Requirement-family → goal copy for locked badges/titles (i18n'd, goal-framed, no urgency). */
function goalCopy(t: Dict, id: string): string {
  const world = MEDAL_WORLDS[id];
  if (world) return fmt(t.identity.goalCompleteWorld, { world });
  switch (id) {
    case "crown_all":
    case "trivia_menace":
      return t.identity.goalCompleteAllWorlds;
    case "perfectionist":
    case "perfect_clear":
      return t.identity.goalPerfectAnyWorld;
    case "podium_finisher":
      return t.identity.goalTopThreeOnce;
    case "podium_regular":
      return fmt(t.identity.goalTopThreeMany, { n: 3 });
    case "first_crown":
    case "champion":
      return t.identity.goalWinRanked;
    case "crown_chaser":
      return t.identity.goalEnterRanked;
    case "world_traveler":
      return fmt(t.identity.goalCompleteWorlds, { n: 3 });
    default:
      return "";
  }
}

export function IdentityEditor({ onClose }: { onClose: () => void }) {
  const t = useT();
  const me = useSessionStore((s) => s.me);
  const setMe = useSessionStore((s) => s.setMe);
  const [tab, setTab] = useState<EditorTab>("avatar");
  const [busy, setBusy] = useState(false);
  // The just-confirmed avatar pick (server value) — drives the one-shot pop on that option.
  const [picked, setPicked] = useState<string | null>(null);
  // Badge/title catalog with server-computed earned state; null = still loading.
  const [identity, setIdentity] = useState<IdentityResponse | null>(null);
  // One-shot refusal shake on the badge whose 4th-pick tap was blocked client-side.
  const [refusedBadge, setRefusedBadge] = useState<string | null>(null);
  // Unmount guard: post-await setState is gated on this ref (mirrors VaultScreen's pattern).
  const mountedRef = useRef(true);
  const closeTimerRef = useRef<number | null>(null);
  const shakeTimerRef = useRef<number | null>(null);

  const currentPreset = me?.avatar_preset;
  const equippedBadges = me?.equipped_badges ?? [];
  const equippedTitle = me?.equipped_title ?? null;

  useEffect(() => {
    mountedRef.current = true;
    api
      .getIdentity()
      .then((res) => {
        if (mountedRef.current) setIdentity(res);
      })
      .catch(() => {
        // Leave the loading state — the avatar tab still works; a mutation refetch reconciles.
      });
    return () => {
      mountedRef.current = false;
      if (closeTimerRef.current != null) window.clearTimeout(closeTimerRef.current);
      if (shakeTimerRef.current != null) window.clearTimeout(shakeTimerRef.current);
    };
  }, []);

  /** Error path shared by every mutation: silently refetch /me + /identity (server truth wins). */
  async function recover() {
    try {
      const [freshMe, freshIdentity] = await Promise.all([api.me(), api.getIdentity()]);
      if (!mountedRef.current) return;
      setMe(freshMe);
      setIdentity(freshIdentity);
    } catch {
      // keep current state — next /me read reconciles
    }
    if (mountedRef.current) setBusy(false);
  }

  async function pickPreset(presetId: string) {
    if (busy) return;
    if (presetId === currentPreset) {
      onClose(); // already wearing it — nothing to save
      return;
    }
    setBusy(true);
    try {
      const res = await api.setAvatar(presetId);
      if (!mountedRef.current) return;
      // Server-authoritative: the store gets the response's avatar_preset, never the tapped id.
      const freshMe = useSessionStore.getState().me;
      if (freshMe) setMe({ ...freshMe, avatar_preset: res.avatar_preset });
      // Let the gold halo + check + pop land on the new pick for one beat, then close.
      // (busy stays true so nothing else is tappable during the beat.)
      setPicked(res.avatar_preset);
      closeTimerRef.current = window.setTimeout(() => {
        if (mountedRef.current) onClose();
      }, CLOSE_BEAT_MS);
    } catch {
      await recover();
    }
  }

  async function toggleBadge(item: IdentityItem) {
    if (busy || !item.earned) return;
    const isEquipped = equippedBadges.includes(item.id);
    if (!isEquipped && equippedBadges.length >= MAX_BADGES) {
      // Client-side guard: the 4th pick never reaches the API — a gentle refusal shake instead.
      if (shakeTimerRef.current != null) window.clearTimeout(shakeTimerRef.current);
      setRefusedBadge(item.id);
      shakeTimerRef.current = window.setTimeout(() => {
        if (mountedRef.current) setRefusedBadge(null);
      }, SHAKE_MS);
      return;
    }
    const next = isEquipped
      ? equippedBadges.filter((b) => b !== item.id)
      : [...equippedBadges, item.id];
    setBusy(true);
    try {
      const res = await api.setBadges(next);
      if (!mountedRef.current) return;
      // Server-authoritative: the store gets the response's list, never the optimistic pick.
      const freshMe = useSessionStore.getState().me;
      if (freshMe) setMe({ ...freshMe, equipped_badges: res.equipped_badges });
      setBusy(false);
    } catch {
      await recover();
    }
  }

  async function pickTitle(titleId: string | null) {
    if (busy) return;
    if (titleId === equippedTitle) return; // already wearing it — nothing to save
    setBusy(true);
    try {
      const res = await api.setTitle(titleId);
      if (!mountedRef.current) return;
      const freshMe = useSessionStore.getState().me;
      if (freshMe) setMe({ ...freshMe, equipped_title: res.equipped_title });
      setBusy(false);
    } catch {
      await recover();
    }
  }

  const subtitle =
    tab === "avatar"
      ? t.identity.subtitle
      : tab === "badges"
        ? t.identity.subtitleBadges
        : t.identity.subtitleTitle;

  return (
    <>
      {/* Dim overlay — same pattern as the Vault ConfirmSheet / ProfileMenu */}
      <button
        type="button"
        aria-label={t.identity.close}
        onClick={onClose}
        className="rr-scrim"
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 80,
          border: "none",
          background: "rgba(8,4,20,.6)",
          cursor: "default",
          animation: "rr-fade-in .25s ease",
        }}
      />
      <div style={{ position: "fixed", bottom: 0, left: 0, right: 0, zIndex: 90, padding: "0 16px calc(32px + env(safe-area-inset-bottom))" }}>
        <div
          className="rr-sheet-in rr-menu"
          style={{
            maxWidth: 480,
            margin: "0 auto",
            display: "flex",
            flexDirection: "column",
            gap: 14,
            padding: "24px 20px",
            borderRadius: 22,
            background: "linear-gradient(180deg, var(--panel2), var(--panel))",
            border: "1px solid color-mix(in srgb, var(--brand) 50%, transparent)",
            boxShadow:
              "0 24px 50px rgba(0,0,0,.6), 0 0 30px color-mix(in srgb, var(--brand) 18%, transparent), inset 0 1px 0 rgba(255,255,255,.07)",
          }}
        >
          <div>
            <Display pop style={{ fontSize: 24 }}>
              {t.identity.title}
            </Display>
            <div style={{ marginTop: 4, fontSize: 12, color: "var(--muted)", fontWeight: 700 }}>
              {subtitle}
            </div>
          </div>

          {/* Avatar | Badges | Title segmented control — same pattern as VaultScreen's tabs. */}
          <div
            role="tablist"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 4,
              padding: 4,
              borderRadius: 999,
              background: "color-mix(in srgb, var(--panel) 60%, transparent)",
              border: "1px solid var(--line)",
            }}
          >
            <EditorTabButton
              label={t.identity.tabAvatar}
              active={tab === "avatar"}
              onClick={() => setTab("avatar")}
            />
            <EditorTabButton
              label={t.identity.tabBadges}
              active={tab === "badges"}
              onClick={() => setTab("badges")}
            />
            <EditorTabButton
              label={t.identity.tabTitle}
              active={tab === "title"}
              onClick={() => setTab("title")}
            />
          </div>

          {/* Tab content — capped + scrollable so 10 badge cards never push the sheet offscreen.
           * Keyed by tab: each switch remounts with a one-shot rr-fade-in (opacity-only, collapsed
           * under reduced motion) instead of a hard content pop, and scroll position resets. */}
          <div
            key={tab}
            style={{
              maxHeight: "min(56vh, 520px)",
              overflowY: "auto",
              paddingTop: 2,
              animation: "rr-fade-in .22s ease",
            }}
          >
            {tab === "avatar" && (
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(4, 1fr)",
                  gap: 12,
                  justifyItems: "center",
                }}
              >
                {AVATAR_PRESETS.map((p) => {
                  const isCurrent = p.id === currentPreset;
                  return (
                    <button
                      key={p.id}
                      type="button"
                      data-preset={p.id}
                      aria-pressed={isCurrent}
                      aria-label={isCurrent ? `${p.id} — ${t.identity.current}` : p.id}
                      disabled={busy}
                      onClick={() => void pickPreset(p.id)}
                      // One-shot scale pop on the freshly confirmed pick (transform-only; the
                      // global reduced-motion rule collapses it and the gold halo still marks it).
                      className={picked === p.id ? "rr-pop" : undefined}
                      style={{
                        position: "relative",
                        padding: 5,
                        border: "none",
                        borderRadius: "50%",
                        cursor: busy ? "default" : "pointer",
                        // Gold halo marks the one you're wearing; others sit on a quiet ring.
                        background: isCurrent
                          ? "linear-gradient(180deg, color-mix(in srgb, var(--amber) 78%, white), var(--amber))"
                          : "color-mix(in srgb, var(--brand) 18%, transparent)",
                        boxShadow: isCurrent ? "0 0 16px color-mix(in srgb, var(--amber) 45%, transparent)" : "none",
                        opacity: busy && !isCurrent ? 0.7 : 1,
                      }}
                    >
                      <Avatar size={56} preset={p.id} />
                      {isCurrent && <CheckBadge />}
                    </button>
                  );
                })}
              </div>
            )}

            {tab === "badges" &&
              (identity === null ? (
                <LoadingDots />
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {/* Pick counter — quiet status, gold when full (the case is dressed). */}
                  <div
                    style={{
                      alignSelf: "flex-end",
                      padding: "4px 12px",
                      borderRadius: 999,
                      fontSize: 11,
                      fontWeight: 900,
                      letterSpacing: 1,
                      color: equippedBadges.length >= MAX_BADGES ? "var(--btnText)" : "var(--amber)",
                      background:
                        equippedBadges.length >= MAX_BADGES
                          ? "linear-gradient(180deg, color-mix(in srgb, var(--amber) 78%, white), var(--amber))"
                          : "color-mix(in srgb, var(--amber) 12%, transparent)",
                      border: "1px solid color-mix(in srgb, var(--amber) 40%, transparent)",
                    }}
                  >
                    {fmt(t.identity.pickedCount, { n: equippedBadges.length })}
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 10 }}>
                    {identity.badges.map((b) => (
                      <BadgeCard
                        key={b.id}
                        item={b}
                        slot={equippedBadges.indexOf(b.id)}
                        busy={busy}
                        refused={refusedBadge === b.id}
                        goal={goalCopy(t, b.id)}
                        onTap={() => void toggleBadge(b)}
                      />
                    ))}
                  </div>
                </div>
              ))}

            {tab === "title" &&
              (identity === null ? (
                <LoadingDots />
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  <TitleRow
                    id={null}
                    name={t.identity.noTitle}
                    sub={null}
                    flair={null}
                    earned
                    selected={equippedTitle === null}
                    busy={busy}
                    onTap={() => void pickTitle(null)}
                  />
                  {identity.titles.map((item) => {
                    const style = getTitle(item.id);
                    return (
                      <TitleRow
                        key={item.id}
                        id={item.id}
                        name={style?.name ?? item.id}
                        sub={item.earned ? (style?.blurb ?? null) : goalCopy(t, item.id)}
                        flair={style?.flair ?? null}
                        earned={item.earned}
                        selected={equippedTitle === item.id}
                        busy={busy}
                        onTap={() => void pickTitle(item.id)}
                      />
                    );
                  })}
                </div>
              ))}
          </div>
        </div>
      </div>
    </>
  );
}

/** Pill tab button — mirrors VaultScreen's VaultTabButton so the controls feel identical. */
function EditorTabButton({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      style={{
        flex: 1,
        padding: "8px 10px",
        borderRadius: 999,
        border: "none",
        cursor: active ? "default" : "pointer",
        fontFamily: "Fredoka, sans-serif",
        fontWeight: 800,
        fontSize: 13,
        letterSpacing: "0.04em",
        transition: "background 180ms, color 180ms, box-shadow 180ms",
        background: active
          ? "linear-gradient(135deg, var(--brand), color-mix(in srgb, var(--brand) 70%, black))"
          : "transparent",
        color: active ? "var(--text)" : "var(--muted)",
        boxShadow: active
          ? "0 0 14px color-mix(in srgb, var(--brand) 35%, transparent), inset 0 1px 0 rgba(255,255,255,.08)"
          : "none",
      }}
    >
      {label}
    </button>
  );
}

/** Gold check badge perched on the current avatar option (decorative). */
function CheckBadge() {
  return (
    <span
      aria-hidden
      style={{
        position: "absolute",
        right: -2,
        top: -2,
        width: 20,
        height: 20,
        borderRadius: "50%",
        display: "grid",
        placeItems: "center",
        fontSize: 11,
        fontWeight: 900,
        color: "var(--btnText)",
        background: "linear-gradient(180deg, color-mix(in srgb, var(--amber) 78%, white), var(--amber))",
        border: "2px solid color-mix(in srgb, var(--panel) 80%, black)",
        boxShadow: "0 2px 8px rgba(0,0,0,.5)",
      }}
    >
      ✓
    </span>
  );
}

function LoadingDots() {
  return <div style={{ color: "var(--muted)", textAlign: "center", padding: 28 }}>…</div>;
}

/**
 * One badge in the trophy case. Equipped = gold ring + numbered slot chip (the order it sits by
 * your name). Earned = tappable on a quiet ring. Locked = dimmed but still tinted + glowing
 * faintly with amber goal copy — anticipation, never a dead end. `refused` plays the one-shot
 * rr-shake (transform-only; collapses under reduced motion).
 */
function BadgeCard({
  item,
  slot,
  busy,
  refused,
  goal,
  onTap,
}: {
  item: IdentityItem;
  slot: number; // index in the equipped order, -1 when not equipped
  busy: boolean;
  refused: boolean;
  goal: string;
  onTap: () => void;
}) {
  const style = getBadge(item.id);
  const equipped = slot >= 0;
  const locked = !item.earned;
  const tint = style?.tint ?? "var(--brand-2)";
  return (
    <button
      type="button"
      data-badge={item.id}
      aria-pressed={equipped}
      disabled={busy || locked}
      onClick={onTap}
      className={refused ? "rr-shake" : undefined}
      style={{
        position: "relative",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 6,
        padding: "14px 10px 12px",
        borderRadius: 16,
        fontFamily: "inherit",
        textAlign: "center",
        border: equipped ? "1.5px solid color-mix(in srgb, var(--amber) 60%, transparent)" : "1px solid var(--line)",
        background: equipped
          ? "linear-gradient(180deg, color-mix(in srgb, var(--amber) 12%, transparent), color-mix(in srgb, var(--panel) 60%, transparent))"
          : "color-mix(in srgb, var(--panel) 55%, transparent)",
        boxShadow: equipped ? "0 0 16px color-mix(in srgb, var(--amber) 25%, transparent)" : "none",
        opacity: locked ? 0.6 : 1,
        cursor: busy || locked ? "default" : "pointer",
      }}
    >
      {/* Tinted medal disc — the world/honor palette keeps each badge readable at a glance. */}
      <span
        aria-hidden
        className="emoji"
        style={{
          width: 46,
          height: 46,
          borderRadius: "50%",
          display: "grid",
          placeItems: "center",
          fontSize: 24,
          lineHeight: 1,
          background: `radial-gradient(120% 120% at 30% 20%, ${tint}55 0%, ${tint}22 60%, transparent 100%)`,
          border: `1.5px solid ${tint}${locked ? "44" : "88"}`,
          boxShadow: locked ? "none" : `0 0 12px ${tint}40`,
        }}
      >
        {style?.emoji ?? "🎖️"}
      </span>
      <span style={{ fontSize: 12, fontWeight: 800, color: "var(--text)" }}>
        {style?.name ?? item.id}
      </span>
      <span
        style={{
          fontSize: 10,
          lineHeight: 1.35,
          fontWeight: 700,
          color: locked ? "var(--amber)" : "var(--muted)",
        }}
      >
        {locked ? goal : (style?.blurb ?? "")}
      </span>
      {equipped && (
        /* Numbered slot chip: this honor's position in the row by your name (1–3). */
        <span
          aria-hidden
          style={{
            position: "absolute",
            top: -8,
            right: -6,
            width: 20,
            height: 20,
            borderRadius: "50%",
            display: "grid",
            placeItems: "center",
            fontSize: 11,
            fontWeight: 900,
            color: "var(--btnText)",
            background: "linear-gradient(180deg, #FFD24A, #FFB300)",
            border: "2px solid #160730",
            boxShadow: "0 2px 8px rgba(0,0,0,.5)",
          }}
        >
          {slot + 1}
        </span>
      )}
      {locked && (
        <span aria-hidden style={{ position: "absolute", top: 8, right: 10, fontSize: 11 }}>
          🔒
        </span>
      )}
    </button>
  );
}

/**
 * One title option. The name previews its flair (gradient flairs clip to the glyphs). Selected =
 * gold ring + check; locked = dimmed with amber goal copy; "No title" is always available.
 */
function TitleRow({
  id,
  name,
  sub,
  flair,
  earned,
  selected,
  busy,
  onTap,
}: {
  id: string | null;
  name: string;
  sub: string | null;
  flair: string | null;
  earned: boolean;
  selected: boolean;
  busy: boolean;
  onTap: () => void;
}) {
  const locked = !earned;
  return (
    <button
      type="button"
      data-title={id ?? "none"}
      aria-pressed={selected}
      disabled={busy || locked}
      onClick={onTap}
      style={{
        position: "relative",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 10,
        padding: "12px 14px",
        borderRadius: 14,
        fontFamily: "inherit",
        textAlign: "left",
        border: selected ? "1.5px solid color-mix(in srgb, var(--amber) 60%, transparent)" : "1px solid var(--line)",
        background: selected
          ? "linear-gradient(180deg, color-mix(in srgb, var(--amber) 12%, transparent), color-mix(in srgb, var(--panel) 60%, transparent))"
          : "color-mix(in srgb, var(--panel) 55%, transparent)",
        boxShadow: selected ? "0 0 16px color-mix(in srgb, var(--amber) 25%, transparent)" : "none",
        opacity: locked ? 0.6 : 1,
        cursor: busy || locked ? "default" : "pointer",
      }}
    >
      <span style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
        <span
          style={{
            fontSize: 15,
            fontWeight: 900,
            letterSpacing: 0.3,
            ...(flair ? titleFlairStyle(flair) : { color: "var(--muted)" }),
          }}
        >
          {name}
        </span>
        {sub && (
          <span
            style={{
              fontSize: 11,
              lineHeight: 1.35,
              fontWeight: 700,
              color: locked ? "var(--amber)" : "var(--faint)",
            }}
          >
            {sub}
          </span>
        )}
      </span>
      {selected ? (
        <span aria-hidden style={{ color: "var(--amber)", fontWeight: 900, fontSize: 15 }}>
          ✓
        </span>
      ) : locked ? (
        <span aria-hidden style={{ fontSize: 12 }}>
          🔒
        </span>
      ) : null}
    </button>
  );
}
