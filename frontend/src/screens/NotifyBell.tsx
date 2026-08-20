import { useEffect, useState } from "react";
import { disablePush, enablePush, getPushState, type PushState } from "@/lib/push";
import { GlassCard } from "@/ui/GlassCard";

/**
 * Unobtrusive reminders opt-in (M9): a small header bell that opens a popover. Permission is
 * requested only on explicit click; every unsupported/denied/iOS path shows an honest message.
 */
export function NotifyBell() {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getPushState()
      .then(setState)
      .catch(() => setState("unsupported"));
  }, []);

  async function set(on: boolean) {
    setBusy(true);
    try {
      setState(on ? await enablePush() : await disablePush());
    } catch {
      setState("unsupported");
    } finally {
      setBusy(false);
    }
  }

  const on = state === "subscribed";

  return (
    <div style={{ position: "relative" }}>
      <button
        type="button"
        aria-label="Game reminders"
        title="Game reminders"
        onClick={() => setOpen((o) => !o)}
        style={{
          width: 38,
          height: 38,
          borderRadius: 10,
          border: "1px solid var(--line)",
          background: "transparent",
          cursor: "pointer",
          fontSize: 16,
          lineHeight: 1,
          color: on ? "var(--amber)" : "var(--muted)",
        }}
      >
        {on ? "🔔" : "🔕"}
      </button>

      {open && (
        <>
          {/* click-away */}
          <button
            type="button"
            aria-label="Close"
            onClick={() => setOpen(false)}
            style={{
              position: "fixed",
              inset: 0,
              zIndex: 40,
              border: "none",
              background: "transparent",
              cursor: "default",
            }}
          />
          <div style={{ position: "absolute", right: 0, top: "112%", zIndex: 50, width: 250 }}>
            <GlassCard style={{ display: "flex", flexDirection: "column", gap: 8, padding: 14 }}>
              <div
                style={{
                  fontSize: 11,
                  letterSpacing: 2,
                  textTransform: "uppercase",
                  fontWeight: 800,
                  color: "var(--brand-2)",
                }}
              >
                Game reminders
              </div>
              <div style={{ color: "var(--muted)", fontSize: 13 }}>
                {state === "subscribed"
                  ? "On. We'll remind you about the daily game and your streak. No spam."
                  : state === "denied"
                    ? "Blocked. Turn notifications back on in your device or browser settings."
                    : state === "ios-needs-pwa"
                      ? "On iPhone/iPad: Share → Add to Home Screen, then open the app and enable this."
                      : state === "unsupported"
                        ? "This browser doesn't support push notifications."
                        : "Turn on reminders so the daily game and your streak don't slip by."}
              </div>
              {state === "subscribed" ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void set(false)}
                  style={ghostBtn}
                >
                  {busy ? "…" : "Turn off"}
                </button>
              ) : state === "default" ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void set(true)}
                  style={primaryBtn}
                >
                  {busy ? "…" : "Notify me"}
                </button>
              ) : null}
            </GlassCard>
          </div>
        </>
      )}
    </div>
  );
}

const primaryBtn: React.CSSProperties = {
  padding: "9px 14px",
  borderRadius: 10,
  border: "none",
  background: "linear-gradient(180deg, color-mix(in srgb, var(--amber) 78%, white), var(--amber))",
  color: "var(--btnText)",
  fontWeight: 800,
  cursor: "pointer",
};

const ghostBtn: React.CSSProperties = {
  padding: "9px 14px",
  borderRadius: 10,
  border: "1px solid var(--line)",
  background: "transparent",
  color: "var(--muted)",
  fontWeight: 800,
  cursor: "pointer",
};
