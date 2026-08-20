import { useState } from "react";
import { ApiError, api } from "@/api/client";
import { useT } from "@/i18n/useT";
import { haptic, uiTap } from "@/lib/sfx";

type State = "idle" | "sending" | "done";

/**
 * One-tap "add this player" — the affordance that turns every place we show another human into a
 * place you can act on.
 *
 * Two reasons this exists as a shared control rather than inline buttons:
 *  - it appears wherever a real player is on screen (the results field, the friends suggestions),
 *    and those surfaces must not drift apart;
 *  - it owns the one piece of logic that is easy to get wrong — "already friends" and "request
 *    already sent" are SUCCESS, not failure. The player asked for a connection and there is one, so
 *    the button lands on `done` instead of flashing an error at them.
 *
 * Deliberately quiet at rest (hairline + faint glyph). It sits next to a score the player actually
 * came to read; it should be findable, not shouty. `variant="pill"` is the louder form for the
 * suggestions list, where adding IS the point of the row.
 */
export function AddFriendButton({
  username,
  variant = "icon",
  onAdded,
}: {
  username: string;
  /** "icon" = 30px circle for dense rows; "pill" = labelled, for suggestion lists. */
  variant?: "icon" | "pill";
  onAdded?: (username: string) => void;
}) {
  const t = useT();
  const [state, setState] = useState<State>("idle");
  const [hot, setHot] = useState(false);

  async function send() {
    if (state !== "idle") return;
    uiTap();
    setState("sending");
    try {
      await api.sendFriendRequest(username);
      haptic(18);
      setState("done");
      onAdded?.(username);
    } catch (err) {
      // A connection that already exists is the outcome the player wanted — treat it as done.
      // The server's snake_case code arrives in `message` (see FriendsScreen.mapError).
      const code = err instanceof ApiError ? err.message : undefined;
      if (code === "already_friends" || code === "request_exists") {
        setState("done");
        onAdded?.(username);
        return;
      }
      setState("idle"); // genuinely failed (offline, unknown user) — let them retry
    }
  }

  const done = state === "done";
  const label = done ? t.friends.requested : t.friends.addAction;

  if (variant === "pill") {
    return (
      <button
        type="button"
        onClick={() => void send()}
        disabled={state !== "idle"}
        aria-label={`${label}: ${username}`}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          padding: "7px 14px",
          borderRadius: 999,
          fontSize: 12.5,
          fontWeight: 800,
          cursor: state === "idle" ? "pointer" : "default",
          transition: "background 160ms ease, color 160ms ease, border-color 160ms ease",
          // Outline at rest. A stack of solid pills reads as nagging on a screen whose whole
          // point is to offer rather than push — and once added, a soft fill (not a heavier
          // border) is what separates "done" from "available" at a glance.
          ...(done
            ? {
                border: "1.5px solid transparent",
                background: "color-mix(in srgb, var(--brand) 16%, transparent)",
                color: "var(--brand-2)",
              }
            : {
                border: "1.5px solid color-mix(in srgb, var(--brand) 55%, transparent)",
                background: "transparent",
                color: "var(--brand-2)",
              }),
        }}
      >
        {state === "sending" ? "…" : done ? <CheckGlyph /> : <PersonPlusGlyph />}
        <span>{state === "sending" ? "" : label}</span>
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={() => void send()}
      disabled={state !== "idle"}
      aria-label={`${label}: ${username}`}
      title={label}
      onPointerEnter={() => setHot(true)}
      onPointerLeave={() => setHot(false)}
      style={{
        flex: "none",
        width: 30,
        height: 30,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        borderRadius: "50%",
        cursor: state === "idle" ? "pointer" : "default",
        transition: "background 160ms ease, color 160ms ease, border-color 160ms ease",
        // Done reads as a filled brand disc — a small, earned-looking full stop.
        ...(done
          ? {
              border: "1px solid transparent",
              background: "color-mix(in srgb, var(--brand) 16%, transparent)",
              color: "var(--brand-2)",
            }
          : {
              border: `1px solid color-mix(in srgb, var(--line) ${hot ? "0%" : "90%"}, transparent)`,
              background: hot ? "color-mix(in srgb, var(--brand) 12%, transparent)" : "transparent",
              color: hot ? "var(--brand-2)" : "var(--faint)",
            }),
      }}
    >
      {state === "sending" ? (
        <span style={{ fontSize: 12, fontWeight: 800 }}>…</span>
      ) : done ? (
        <CheckGlyph />
      ) : (
        <PersonPlusGlyph />
      )}
    </button>
  );
}

function PersonPlusGlyph() {
  return (
    <svg viewBox="0 0 24 24" width={15} height={15} aria-hidden fill="none" stroke="currentColor" strokeWidth={2.1} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="9" cy="8" r="3.4" />
      <path d="M3 20c0-3.3 2.7-5.6 6-5.6s6 2.3 6 5.6" />
      <path d="M18 8.5v5M15.5 11h5" />
    </svg>
  );
}

function CheckGlyph() {
  return (
    <svg viewBox="0 0 24 24" width={15} height={15} aria-hidden fill="none" stroke="currentColor" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 12.5l5.2 5.2L20 7" />
    </svg>
  );
}
