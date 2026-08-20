import { useEffect, useState } from "react";
import { ChangeUsernameSheet } from "@/screens/home/ChangeUsernameSheet";
import { fmt, useT } from "@/i18n/useT";
import { api, type DuelStatsResponse } from "@/api/client";
import { signOut } from "@/api/session";
import { LanguageSelector } from "@/i18n/LanguageSelector";
import {
  disablePush,
  enablePush,
  getPushState,
  type PushState,
} from "@/lib/push";
import { FitText } from "@/ui/FitText";
import { GemIcon } from "@/ui/GemIcon";
import { Avatar } from "@/screens/home/Avatar";
import { IdentityEditor } from "@/screens/home/IdentityEditor";
import { getBadge, getTitle, titleFlairStyle } from "@/theme/identity";
import { useArtStyle } from "@/theme/useArtStyle";

/**
 * Avatar/profile popover. Keeps the header clean (no "Sign out" chrome, no glaring bell) while
 * preserving: game-reminder opt-in (reused push helpers, honest per-state copy), sign-out,
 * identity editing (the tabbed IdentityEditor bottom sheet) and the language selector (its only
 * authenticated home since it left the headers). The identity block shows the equipped title
 * (flair-colored) under the username plus the pinned badge emoji row — visible status, straight
 * from /me. Opened from the header avatar and the bottom-nav profile button.
 *
 * Hierarchy: ONE hero action (the identity card), then quiet grouped rows. Everything below it
 * is deliberately low-contrast — a menu where every row shouts equally is a menu where nothing
 * gets found, which is how the avatar picker stayed hidden behind a plain "Edit identity" row.
 * Global Elo rank was removed from here: standings belong to the Leaderboard, not a settings menu.
 */
// Support fallback shown only if the delete request itself errors. Keep in sync with the address
// published on the /support and /privacy pages.
const SUPPORT_EMAIL = "thomas@webhorizondigital.com";

export function ProfileMenu({
  username,
  avatarPreset,
  equippedFrame,
  equippedBadges,
  equippedTitle,
  onClose,
  onOpenVault,
}: {
  username: string;
  avatarPreset?: string;
  equippedFrame?: string | null;
  equippedBadges?: string[];
  equippedTitle?: string | null;
  onClose: () => void;
  onOpenVault?: () => void;
}) {
  const t = useT();
  const mono = useArtStyle() === "mono";
  const [renaming, setRenaming] = useState(false);
  const [state, setState] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);
  // Set when a tap on "Notify me" came back without a live subscription. Kept separate from
  // `state` so the control stays visible and re-tappable instead of collapsing into the flat
  // "unsupported" dead end (which is what a dev build with no service worker always returns).
  const [enableFailed, setEnableFailed] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [duel, setDuel] = useState<DuelStatsResponse | null>(null);
  const [deleteStep, setDeleteStep] = useState<
    "idle" | "confirm" | "deleting" | "error"
  >("idle");

  useEffect(() => {
    getPushState()
      .then(setState)
      .catch(() => setState("unsupported"));
  }, []);

  // Best-effort Duel stats — the menu's only status block now that global Elo rank moved out
  // (the Leaderboard owns standings). Failures stay silent: the section simply doesn't render.
  useEffect(() => {
    let live = true;
    api
      .duelStats()
      .then((s) => {
        if (live) setDuel(s);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);

  async function handleDeleteAccount() {
    setDeleteStep("deleting");
    try {
      await api.deleteAccount();
      await signOut();
    } catch {
      setDeleteStep("error");
    }
  }

  async function setPush(next: boolean) {
    setBusy(true);
    setEnableFailed(false);
    try {
      const result = next ? await enablePush() : await disablePush();
      setState(result);
      // Only `default` is a failure that explains nothing: permission was granted and the
      // subscribe step still didn't land. `denied` / `ios-needs-pwa` / `unsupported` each carry
      // their own actionable copy below — flagging those would replace a real instruction with
      // a retry prompt that can never succeed.
      if (next && result === "default") setEnableFailed(true);
    } catch {
      // Direction matters: a thrown disable must not claim we couldn't turn reminders ON.
      if (next) {
        setEnableFailed(true);
      } else {
        setState(await getPushState().catch(() => null));
      }
    } finally {
      setBusy(false);
    }
  }

  const on = state === "subscribed";
  // Offer the toggle only where a tap can actually change something. `denied`, `ios-needs-pwa`
  // and `unsupported` are dead ends the player must leave the app to fix, so they get the
  // explanation without a button that would lie about being retryable.
  const canToggle = state === "default" || state === "subscribed";
  const titleStyle = getTitle(equippedTitle);
  // Pinned honors as a tiny emoji row (unknown ids render nothing — server ids are the truth).
  const badgeEmojis = (equippedBadges ?? [])
    .map((id) => getBadge(id)?.emoji)
    .filter(Boolean)
    .join(" ");
  // Self-explaining states win over the generic retry line — an iOS user needs "Add to Home
  // Screen", not "try again".
  const reminderCopy =
    state === "subscribed"
      ? t.home.reminderOn
      : state === "denied"
      ? t.home.reminderBlocked
      : state === "ios-needs-pwa"
      ? t.home.reminderIosPwa
      : state === "unsupported"
      ? t.home.reminderUnsupported
      : enableFailed
      ? t.home.reminderFailed
      : t.home.reminderDefault;

  return (
    <>
      <button
        type="button"
        aria-label={t.home.closeMenu}
        onClick={onClose}
        className="rr-scrim"
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 60,
          border: "none",
          background: "rgba(8,4,20,.5)",
          cursor: "default",
        }}
      />
      <div
        style={{
          position: "fixed",
          top: "calc(70px + env(safe-area-inset-top))",
          right: 16,
          zIndex: 70,
          width: 260,
        }}
      >
        <div
          className="rr-menu"
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 12,
            padding: 16,
            borderRadius: 22,
            background: "linear-gradient(180deg, var(--panel2), var(--panel))",
            border:
              "1px solid color-mix(in srgb, var(--brand) 40%, transparent)",
            boxShadow: "0 24px 50px rgba(0,0,0,.55)",
            // Never exceed the viewport: cap to the space below the 70px anchor (minus safe-area
            // insets + a 16px bottom gap) and scroll internally, so the bottom of the menu
            // (Delete account) is always reachable on short screens. 100dvh tracks mobile chrome.
            maxHeight:
              "calc(100dvh - 70px - env(safe-area-inset-top) - env(safe-area-inset-bottom) - 16px)",
            overflowY: "auto",
            WebkitOverflowScrolling: "touch",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Avatar
              size={40}
              online
              ring="var(--brand)"
              preset={avatarPreset}
              frame={equippedFrame}
            />
            <div style={{ minWidth: 0 }}>
              {/* The handle is a control, not a label: tapping it opens the rename sheet. Styled
                  with a dotted underline + pencil so it reads as editable without shouting. */}
              <button
                type="button"
                onClick={() => setRenaming(true)}
                aria-label={t.changeName.title}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  minHeight: 32,
                  padding: 0,
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  font: "inherit",
                  fontWeight: 800,
                  color: "var(--text)",
                  textDecoration: "underline dotted",
                  textUnderlineOffset: 4,
                  maxWidth: "100%",
                }}
              >
                <span
                  style={{
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {username}
                </span>
                <PencilGlyph />
              </button>
              {/* Equipped title in its flair (earned status) — falls back to the signed-in line. */}
              {titleStyle ? (
                <div
                  style={{
                    fontSize: 11,
                    fontWeight: 900,
                    letterSpacing: 0.4,
                    whiteSpace: "nowrap",
                    ...titleFlairStyle(titleStyle.flair),
                  }}
                >
                  {titleStyle.name}
                </div>
              ) : (
                <div
                  style={{
                    fontSize: 11,
                    color: "var(--faint)",
                    fontWeight: 700,
                  }}
                >
                  {t.home.signedIn}
                </div>
              )}
              {badgeEmojis && (
                <div
                  aria-hidden
                  className="emoji"
                  style={{ marginTop: 2, fontSize: 13, letterSpacing: 3 }}
                >
                  {badgeEmojis}
                </div>
              )}
            </div>
          </div>

          {/* ── Identity — the menu's hero action ──────────────────────────────────────────
              Promoted out of the row list because "Edit identity" as a plain row told nobody
              that this is where the avatar is chosen. The avatar thumbnail makes the link
              literal and the sub-line names what's inside. */}
          <button
            type="button"
            onClick={() => setPickerOpen(true)}
            className="rr-tap"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              width: "100%",
              textAlign: "left",
              padding: "10px 12px",
              borderRadius: 16,
              cursor: "pointer",
              color: "inherit",
              background:
                "linear-gradient(180deg, color-mix(in srgb, var(--brand) 20%, transparent), color-mix(in srgb, var(--brand) 9%, transparent))",
              border:
                "1px solid color-mix(in srgb, var(--brand) 45%, transparent)",
            }}
          >
            <Avatar size={34} preset={avatarPreset} frame={equippedFrame} />
            <span style={{ display: "flex", flexDirection: "column", minWidth: 0, flex: 1, gap: 1 }}>
              <FitText
                as="span"
                size={13.5}
                min={0.7}
                style={{ fontWeight: 900, color: "var(--text)", width: "100%", whiteSpace: "nowrap" }}
              >
                {t.identity.edit}
              </FitText>
              <FitText
                as="span"
                size={10.5}
                min={0.66}
                style={{ fontWeight: 700, color: "var(--muted)", width: "100%", whiteSpace: "nowrap" }}
              >
                {t.identity.editSub}
              </FitText>
            </span>
            <span style={{ fontWeight: 900, fontSize: 15, color: "var(--amber)", flex: "none" }}>
              →
            </span>
          </button>

          {/* Duel — secondary skill status. */}
          {duel && (
            <>
              <div style={{ height: 1, background: "var(--line)" }} />
              <DuelStatsSection stats={duel} />
            </>
          )}

          <div style={{ height: 1, background: "var(--line)" }} />

          {/* Vault + Language — one quiet group, no hairline between them. */}
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {onOpenVault && (
              <button
                type="button"
                onClick={onOpenVault}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 8,
                  padding: 0,
                  border: "none",
                  background: "transparent",
                  cursor: "pointer",
                }}
              >
                <FitText
                  as="span"
                  size={13}
                  min={0.7}
                  style={{
                    fontWeight: 800,
                    color: "var(--text)",
                    flex: "0 1 auto",
                    minWidth: 0,
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                  }}
                >
                  {t.vault.menuLabel}
                </FitText>
                {/* Mono skins carry no emoji chrome — the arrow alone is the affordance. */}
                <span
                  style={{
                    fontWeight: 800,
                    fontSize: 13,
                    color: "var(--amber)",
                  }}
                >
                  {mono ? "→" : "🪙 →"}
                </span>
              </button>
            )}

            {/* Language lives here now (and on unauthenticated screens) — not in the headers. */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 8,
              }}
            >
              <FitText
                as="span"
                size={13}
                min={0.7}
                style={{ fontWeight: 800, color: "var(--text)", flex: "0 1 auto", minWidth: 0, whiteSpace: "nowrap", overflow: "hidden" }}
              >
                {t.identity.language}
              </FitText>
              <LanguageSelector variant="inline" />
            </div>
          </div>

          <div style={{ height: 1, background: "var(--line)" }} />

          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 8,
              }}
            >
              <FitText
                as="span"
                size={13}
                min={0.7}
                style={{ fontWeight: 800, color: "var(--text)", flex: "0 1 auto", minWidth: 0, whiteSpace: "nowrap", overflow: "hidden" }}
              >
                {t.home.gameReminders}
              </FitText>
              {/* One control, two states: filled brand = "off, tap to turn on"; the same pill
                  hollowed out = "on, tap to turn off". Same colour throughout so it reads as a
                  toggle rather than two different buttons. */}
              {canToggle && (
                <button
                  type="button"
                  disabled={busy}
                  aria-pressed={on}
                  onClick={() => void setPush(!on)}
                  style={{
                    flex: "none",
                    minWidth: 92,
                    padding: "6px 12px",
                    borderRadius: 999,
                    cursor: busy ? "default" : "pointer",
                    opacity: busy ? 0.6 : 1,
                    fontWeight: 800,
                    fontSize: 12,
                    transition: "background 160ms ease, color 160ms ease",
                    ...(on
                      ? {
                          border: "1.5px solid var(--brand)",
                          background: "transparent",
                          color: "var(--brand-2)",
                        }
                      : {
                          border: "1.5px solid transparent",
                          background: "var(--brand)",
                          color: "var(--btnText)",
                        }),
                  }}
                >
                  {busy ? "…" : on ? t.home.reminderTurnOff : t.home.notifyMe}
                </button>
              )}
            </div>
            <div
              style={{ fontSize: 12, color: "var(--muted)", lineHeight: 1.4 }}
            >
              {reminderCopy}
            </div>
          </div>

          <div style={{ height: 1, background: "var(--line)" }} />

          {/* Support / legal — one quiet group. These are obligations, not destinations, so they
              sit at small type in a single block instead of three full-weight rows. */}
          <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 14px" }}>
            {(
              [
                { label: "Support", href: "/support" },
                { label: "Privacy Policy", href: "/privacy" },
                { label: "Terms of Use", href: "/terms" },
              ] as const
            ).map(({ label, href }) => (
              <a
                key={href}
                href={href}
                style={{
                  fontWeight: 700,
                  fontSize: 11.5,
                  color: "var(--muted)",
                  textDecoration: "none",
                }}
              >
                {label}
              </a>
            ))}
          </div>

          <div style={{ height: 1, background: "var(--line)" }} />

          <button
            type="button"
            onClick={() => void signOut()}
            style={{
              padding: "11px 14px",
              borderRadius: 12,
              border: "1px solid var(--line)",
              background: "transparent",
              color: "var(--muted)",
              fontWeight: 800,
              cursor: "pointer",
            }}
          >
            {t.home.signOut}
          </button>

          {/* Delete account — danger zone, two-step confirm */}
          <div style={{ height: 1, background: "var(--line)" }} />

          {deleteStep === "idle" && (
            <button
              type="button"
              onClick={() => setDeleteStep("confirm")}
              style={{
                padding: "11px 14px",
                borderRadius: 12,
                border: "1px solid rgba(255,46,77,.45)",
                background: "rgba(255,46,77,.08)",
                color: "#FF2E4D",
                fontWeight: 800,
                cursor: "pointer",
                textAlign: "center",
              }}
            >
              {t.home.deleteAccount}
            </button>
          )}

          {deleteStep === "confirm" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <p
                style={{
                  fontSize: 12,
                  color: "var(--muted)",
                  lineHeight: 1.45,
                }}
              >
                {t.home.deleteConfirm}
              </p>
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  type="button"
                  onClick={() => setDeleteStep("idle")}
                  style={{
                    flex: 1,
                    padding: "8px",
                    borderRadius: 10,
                    border: "1px solid var(--line)",
                    background: "transparent",
                    color: "var(--muted)",
                    fontWeight: 800,
                    cursor: "pointer",
                    fontSize: 12,
                  }}
                >
                  {t.home.deleteCancel}
                </button>
                <button
                  type="button"
                  onClick={() => void handleDeleteAccount()}
                  style={{
                    flex: 1,
                    padding: "8px",
                    borderRadius: 10,
                    border: "1px solid rgba(255,46,77,.4)",
                    background: "rgba(255,46,77,.12)",
                    color: "#FF2E4D",
                    fontWeight: 800,
                    cursor: "pointer",
                    fontSize: 12,
                  }}
                >
                  {t.home.deleteConfirmBtn}
                </button>
              </div>
            </div>
          )}

          {deleteStep === "deleting" && (
            <p style={{ fontSize: 12, color: "var(--muted)" }}>
              {t.home.deleting}
            </p>
          )}

          {deleteStep === "error" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <p style={{ fontSize: 12, color: "#FF2E4D", lineHeight: 1.4 }}>
                {(() => {
                  // Localized error copy with a tappable mailto in place of the {email} token.
                  const [pre, post] = t.home.deleteError.split("{email}");
                  return (
                    <>
                      {pre}
                      <a
                        href={`mailto:${SUPPORT_EMAIL}`}
                        style={{ color: "#FF2E4D" }}
                      >
                        {SUPPORT_EMAIL}
                      </a>
                      {post}
                    </>
                  );
                })()}
              </p>
              <button
                type="button"
                onClick={() => setDeleteStep("idle")}
                style={{
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  fontSize: 12,
                  color: "var(--muted)",
                  fontWeight: 700,
                  padding: 0,
                  textAlign: "left",
                }}
              >
                {t.home.deleteDismiss}
              </button>
            </div>
          )}
        </div>
      </div>

      {pickerOpen && <IdentityEditor onClose={() => setPickerOpen(false)} />}

      {renaming && (
        <ChangeUsernameSheet
          currentUsername={username}
          onClose={() => setRenaming(false)}
          onChanged={() => setRenaming(false)}
        />
      )}
    </>
  );
}

/**
 * Compact Duel skill-stats block for the profile popover (secondary to the Daily Royale rank).
 * A labeled tier line (⚔️ + earned duelist tier) followed by a tight stat grid — Record (Gem-duel
 * W·L), Streak (current, best in parens), and Gems Won. Honest framing: these are skill outcomes,
 * not cash or advantage. Renders fine at all-zeros for a brand-new duelist (aspirational baseline).
 * Exported for SSR unit testing as a pure presentational component.
 */
export function DuelStatsSection({ stats }: { stats: DuelStatsResponse }) {
  const t = useT();
  const tier =
    t.duel.duelTier[stats.duel_tier as keyof typeof t.duel.duelTier] ??
    t.duel.duelTier.bronze;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {/* Tier status line. */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
        }}
      >
        <FitText
          as="span"
          size={13}
          min={0.7}
          style={{ fontWeight: 800, color: "var(--text)", flex: "0 1 auto", minWidth: 0, whiteSpace: "nowrap", overflow: "hidden" }}
        >
          {t.duel.duelSection}
        </FitText>
        <span
          style={{ fontWeight: 800, fontSize: 13, color: "var(--brand-2)" }}
        >
          <span aria-hidden className="emoji">
            ⚔️
          </span>{" "}
          {tier}
        </span>
      </div>

      {/* Tight stat grid: Record · Streak · Gems Won. */}
      <div
        style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6 }}
      >
        <DuelStat
          label={t.duel.record}
          value={fmt(t.duel.recordValue, { w: stats.wins, l: stats.losses })}
        />
        <DuelStat
          label={t.duel.bestStreak}
          value={
            <>
              <span aria-hidden className="emoji">
                🔥
              </span>
              {stats.current_streak}
              <span style={{ color: "var(--faint)", fontWeight: 700 }}>
                {" "}
                /{stats.best_streak}
              </span>
            </>
          }
          accent="var(--amber)"
        />
        <DuelStat
          label={t.duel.gemsWon}
          value={
            <span
              style={{ display: "inline-flex", alignItems: "center", gap: 3 }}
            >
              <GemIcon size={12} />
              {stats.total_gems_won}
            </span>
          }
          accent="var(--cyan)"
        />
      </div>
    </div>
  );
}

/** One cell of the Duel stat grid: a muted micro-label over an 800-weight value. */
function DuelStat({
  label,
  value,
  accent = "var(--text)",
}: {
  label: string;
  value: React.ReactNode;
  accent?: string;
}) {
  return (
    <div
      style={{ display: "flex", flexDirection: "column", gap: 1, minWidth: 0 }}
    >
      <FitText
        as="span"
        size={9}
        min={0.66}
        style={{
          fontWeight: 800,
          letterSpacing: 0.3,
          textTransform: "uppercase",
          color: "var(--muted)",
          width: "100%",
          whiteSpace: "nowrap",
          overflow: "hidden",
        }}
      >
        {label}
      </FitText>
      <span
        style={{
          fontWeight: 800,
          fontSize: 12,
          color: accent,
          whiteSpace: "nowrap",
        }}
      >
        {value}
      </span>
    </div>
  );
}

/** Small pencil mark beside the handle — signals "editable" without a heavy button. */
function PencilGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      width={13}
      height={13}
      aria-hidden
      style={{ flex: "none", opacity: 0.75 }}
    >
      <path
        d="M4 20h4L20 8l-4-4L4 16v4Z"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinejoin="round"
      />
    </svg>
  );
}
