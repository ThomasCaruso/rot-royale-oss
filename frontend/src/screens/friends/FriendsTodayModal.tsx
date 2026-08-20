import { useEffect, useRef } from "react";
import { FriendsTodayBoard } from "@/screens/results/FriendsTodayBoard";
import { useT } from "@/i18n/useT";

/**
 * Friends-today popup — a beautiful minimal centered dialog over a blurred scrim, holding the daily
 * friends leaderboard. One clean surface (the board renders `bare`, so no card-in-card), a minimal
 * thin-stroke ✕ top-right, and calm entrance motion (scrim fades, panel scales in — both collapse
 * under prefers-reduced-motion). Closes on ✕, backdrop click, or Esc. Opened from the Friends hub.
 */
export function FriendsTodayModal({
  windowId,
  onClose,
}: {
  windowId: string;
  onClose: () => void;
}) {
  const t = useT();
  const closeRef = useRef<HTMLButtonElement>(null);

  // Esc closes; focus the ✕ on open so the dialog is immediately dismissible by keyboard.
  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      onClick={onClose}
      className="rr-scrim"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 90,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "20px",
        paddingBottom: "calc(20px + env(safe-area-inset-bottom))",
        background: "rgba(8, 4, 20, 0.5)",
        WebkitBackdropFilter: "blur(6px)",
        backdropFilter: "blur(6px)",
        animation: "rr-fade-in 0.22s ease",
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t.friendsToday.title}
        onClick={(e) => e.stopPropagation()}
        className="rr-splash-in"
        style={{
          position: "relative",
          width: "100%",
          maxWidth: 440,
          maxHeight: "82vh",
          overflowY: "auto",
          background: "var(--panel)",
          border: "1px solid var(--line)",
          borderRadius: 24,
          // Extra top padding reserves a clear header zone for the ✕ so it never sits over the
          // board's top-right "#rank of N" text.
          padding: "52px 22px 24px",
          boxShadow: "0 30px 70px rgba(0, 0, 0, 0.55), inset 0 1px 0 var(--sheen)",
        }}
      >
        <button
          ref={closeRef}
          type="button"
          aria-label={t.common.close}
          onClick={onClose}
          style={{
            position: "absolute",
            top: 10,
            right: 10,
            width: 40,
            height: 40,
            borderRadius: 999,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            border: "1px solid color-mix(in srgb, var(--line) 80%, transparent)",
            background: "color-mix(in srgb, var(--panel2) 60%, transparent)",
            color: "var(--muted)",
            cursor: "pointer",
            padding: 0,
            zIndex: 1,
          }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
            <path
              d="M6 6l12 12M18 6L6 18"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </svg>
        </button>
        <FriendsTodayBoard windowId={windowId} bare />
      </div>
    </div>
  );
}
