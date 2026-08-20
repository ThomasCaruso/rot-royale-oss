import { useEffect, useRef, useState } from "react";
import { fmt, useT } from "@/i18n/useT";
import { useNetwork } from "@/store/network";
import { useOutbox } from "@/offline/outbox";

/**
 * App-shell status chrome for offline play. Two independent pieces, both prefers-reduced-motion safe
 * (no essential state is conveyed by motion — the text always says what's happening):
 *
 *  - Offline banner: a slim fixed top strip while the device is offline, with honest copy — progress
 *    is queued and syncs on reconnect (never a "you lost your run" scare, never a fake live claim).
 *  - Sync chip: driven by the outbox pending count. While pending > 0 it shows "Syncing N…"; when the
 *    count drops back to 0 after having been >0, it briefly shows "Synced ✓" then hides.
 */
export function OfflineStatus() {
  const t = useT();
  const online = useNetwork((s) => s.online);
  const pending = useOutbox((s) => s.pending);

  // Transient "Synced ✓" after the queue empties. Tracks whether we were syncing to only celebrate a
  // real drain (not a cold start at 0).
  const [justSynced, setJustSynced] = useState(false);
  const wasPending = useRef(false);
  useEffect(() => {
    if (pending > 0) {
      wasPending.current = true;
      setJustSynced(false);
      return;
    }
    if (wasPending.current) {
      wasPending.current = false;
      setJustSynced(true);
      const id = window.setTimeout(() => setJustSynced(false), 2000);
      return () => window.clearTimeout(id);
    }
  }, [pending]);

  const showChip = pending > 0 || justSynced;

  return (
    <>
      {!online && (
        <div
          role="status"
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            zIndex: 50,
            padding: "6px 12px",
            textAlign: "center",
            fontSize: 13,
            fontWeight: 600,
            color: "var(--btnText, #1a1a1a)",
            background: "var(--amber, #e0a418)",
            boxShadow: "0 2px 8px rgba(0,0,0,.25)",
          }}
        >
          {t.offline.banner}
        </div>
      )}
      {showChip && (
        <div
          role="status"
          style={{
            position: "fixed",
            top: online ? 10 : 40,
            right: 10,
            zIndex: 50,
            padding: "5px 12px",
            borderRadius: 999,
            fontSize: 12,
            fontWeight: 600,
            color: "var(--text, #fff)",
            background: "var(--panel2, rgba(20,20,30,.85))",
            border: "1px solid var(--faint, rgba(255,255,255,.15))",
            boxShadow: "0 2px 8px rgba(0,0,0,.3)",
          }}
        >
          {pending > 0 ? fmt(t.offline.syncing, { n: pending }) : t.offline.synced}
        </div>
      )}
    </>
  );
}
