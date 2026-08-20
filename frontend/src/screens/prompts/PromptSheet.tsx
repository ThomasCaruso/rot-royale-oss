import { useEffect, useState } from "react";
import { GlassCard } from "@/ui/GlassCard";
import { GoldButton } from "@/ui/GoldButton";
import { useReducedMotion } from "@/ui/useReducedMotion";

/**
 * The shell every one-time prompt wears (DESIGN §4 language: glass card, gold CTA, quiet decline).
 *
 * Deliberately a SHEET, not a dialog box. It rises from the bottom on a spring, over a dimmed but
 * still-visible game — the player should feel interrupted by the app they're enjoying, not stopped
 * by the operating system. That framing is the whole job here: the iOS permission alert that
 * follows only ever appears ONCE per install, so this screen's only purpose is to make "yes" the
 * obvious answer before the real alert is spent.
 *
 * The decline is a plain text button, not a second competing CTA. Making "no" hard to find is how
 * an app earns a permanent denial.
 */
export function PromptSheet({
  icon,
  title,
  body,
  confirm,
  decline,
  onConfirm,
  onDecline,
  busy = false,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
  confirm: string;
  decline: string;
  onConfirm: () => void;
  onDecline: () => void;
  busy?: boolean;
}) {
  const reduced = useReducedMotion();
  const [shown, setShown] = useState(false);

  // Mount first, animate second — starting the transition in the same frame as the mount makes the
  // browser skip it and the sheet appears with a snap.
  useEffect(() => {
    const id = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(id);
  }, []);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 300,
        display: "flex",
        flexDirection: "column",
        justifyContent: "flex-end",
        // Backdrop fades with the sheet so the two read as one movement.
        background: `rgba(8, 6, 4, ${shown ? 0.58 : 0})`,
        transition: reduced ? "none" : "background 260ms ease",
        // Tapping the scrim is the same as declining — a trapped player is an annoyed player.
        cursor: "default",
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onDecline();
      }}
    >
      <div
        style={{
          padding: "0 14px calc(14px + env(safe-area-inset-bottom, 0px))",
          transform: shown ? "translateY(0)" : "translateY(24px)",
          opacity: shown ? 1 : 0,
          transition: reduced
            ? "none"
            : "transform 320ms cubic-bezier(0.16, 1, 0.3, 1), opacity 240ms ease",
        }}
      >
        <GlassCard
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 12,
            padding: "26px 22px 20px",
            textAlign: "center",
            maxWidth: 420,
            margin: "0 auto",
          }}
        >
          <div style={{ fontSize: 40, lineHeight: 1 }}>{icon}</div>
          <div
            className="display"
            style={{ fontSize: 21, letterSpacing: 0.2, color: "var(--ink)" }}
          >
            {title}
          </div>
          <div
            style={{
              fontSize: 14.5,
              lineHeight: 1.5,
              opacity: 0.76,
              color: "var(--ink)",
              maxWidth: 320,
            }}
          >
            {body}
          </div>
          <div style={{ width: "100%", marginTop: 6 }}>
            <GoldButton onClick={onConfirm} disabled={busy} idlePulse={!busy}>
              {confirm}
            </GoldButton>
          </div>
          <button
            type="button"
            onClick={onDecline}
            disabled={busy}
            style={{
              background: "none",
              border: "none",
              padding: "8px 12px",
              fontSize: 13.5,
              fontWeight: 600,
              color: "var(--ink)",
              opacity: 0.5,
              cursor: "pointer",
            }}
          >
            {decline}
          </button>
        </GlassCard>
      </div>
    </div>
  );
}
