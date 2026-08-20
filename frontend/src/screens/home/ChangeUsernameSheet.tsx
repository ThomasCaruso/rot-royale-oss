/**
 * Change-your-username sheet, opened by tapping your own name in the profile menu.
 *
 * The price is fetched (`/me/username/quote`) rather than assumed, so the player is told what the
 * change costs BEFORE they type — "your first change is free" or "this costs 300 coins" — and the
 * confirm button never asks them to commit to a price they haven't seen. The server re-prices on
 * submit regardless; this is presentation, not the source of truth.
 */

import { useEffect, useState } from "react";
import { api, type UsernameQuote } from "@/api/client";
import { refreshMe } from "@/api/session";
import { errorMessage } from "@/i18n/errors";
import { fmt, useT } from "@/i18n/useT";
import { activeTag } from "@/i18n/format";
import { GoldButton } from "@/ui/GoldButton";

/** Mirrors the server's USERNAME_RE so the button disables before a round trip can reject it. */
const SHAPE = /^[A-Za-z0-9_]{3,32}$/;

export function ChangeUsernameSheet({
  currentUsername,
  onClose,
  onChanged,
}: {
  currentUsername: string;
  onClose: () => void;
  onChanged: (username: string) => void;
}) {
  const t = useT();
  const [quote, setQuote] = useState<UsernameQuote | null>(null);
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api
      .usernameQuote()
      .then((q) => !cancelled && setQuote(q))
      .catch(() => undefined); // price line just stays hidden; the server still prices on submit
    return () => {
      cancelled = true;
    };
  }, []);

  const trimmed = value.trim();
  const shapeOk = SHAPE.test(trimmed);
  const isSame = trimmed.toLowerCase() === currentUsername.toLowerCase();
  const affordable = quote ? quote.balance >= quote.cost : true;
  const canSubmit = shapeOk && !isSame && affordable && !busy;

  async function submit() {
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.setUsername(trimmed);
      await refreshMe(); // pull the new handle + balance into the session store
      onChanged(res.username);
    } catch (err) {
      setError(errorMessage(err, t, t.auth.somethingWentWrong));
      setBusy(false);
    }
  }

  const n = (v: number) => v.toLocaleString(activeTag());

  return (
    <>
      <div className="rr-scrim" style={scrim} onClick={onClose} aria-hidden />
      <div
        className="rr-menu rr-sheet-in"
        style={sheet}
        role="dialog"
        aria-label={t.changeName.title}
      >
        <div style={{ fontWeight: 800, fontSize: 17, color: "var(--text)" }}>
          {t.changeName.title}
        </div>
        <div style={{ fontSize: 13, color: "var(--muted)", lineHeight: 1.5 }}>
          {t.changeName.sub}
        </div>

        <input
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void submit()}
          placeholder={currentUsername}
          aria-label={t.changeName.label}
          maxLength={32}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          style={input}
        />
        <div style={{ fontSize: 11.5, color: "var(--faint)" }}>
          {t.changeName.rules}
        </div>

        {/* The price, stated before they commit. */}
        {quote && (
          <div
            style={{
              fontSize: 13,
              fontWeight: 700,
              color: quote.cost ? "var(--amber)" : "var(--lime)",
            }}
          >
            {quote.cost === 0
              ? t.changeName.freeOnce
              : `${fmt(t.changeName.costs, { n: n(quote.cost) })} ${fmt(
                  t.changeName.balance,
                  { n: n(quote.balance) }
                )}`}
          </div>
        )}
        {quote && !affordable && (
          <div style={{ fontSize: 13, fontWeight: 700, color: "var(--pink)" }}>
            {fmt(t.changeName.cannotAfford, {
              n: n(quote.cost - quote.balance),
            })}
          </div>
        )}
        {error && (
          <div style={{ fontSize: 13, fontWeight: 700, color: "var(--pink)" }}>
            {error}
          </div>
        )}

        <GoldButton onClick={() => void submit()} disabled={!canSubmit}>
          {busy ? t.changeName.saving : t.changeName.confirm}
        </GoldButton>
        <button type="button" onClick={onClose} style={cancelBtn}>
          {t.changeName.cancel}
        </button>
      </div>
    </>
  );
}

const scrim: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  // Above the ProfileMenu container (z-index 70) — this sheet is opened FROM that menu, so it has
  // to stack over it rather than under. 60/61 put it behind and it rendered invisibly.
  zIndex: 80,
  background: "rgba(10,6,24,.55)",
};

const sheet: React.CSSProperties = {
  position: "fixed",
  bottom: 0,
  // Centred with auto margins, NOT translateX(-50%): the `rr-sheet-in` entrance animates
  // `transform`, which would replace the centering transform outright and slam the sheet
  // half a screen to the right once the animation resolved.
  left: 0,
  right: 0,
  marginInline: "auto",
  zIndex: 81,
  width: "min(430px, 100%)",
  display: "flex",
  flexDirection: "column",
  gap: 10,
  padding: "20px 20px calc(24px + env(safe-area-inset-bottom))",
  borderRadius: "22px 22px 0 0",
  background: "var(--panel)",
  border: "1px solid var(--line)",
};

const input: React.CSSProperties = {
  width: "100%",
  padding: "13px 14px",
  borderRadius: 14,
  border: "1px solid var(--line)",
  background: "var(--panel2)",
  color: "var(--text)",
  fontSize: 16, // >=16px so iOS Safari doesn't zoom the page when the field focuses
  fontFamily: "inherit",
  outline: "none",
};

const cancelBtn: React.CSSProperties = {
  background: "none",
  border: "none",
  color: "var(--muted)",
  fontWeight: 700,
  fontSize: 13.5,
  cursor: "pointer",
  padding: 10,
  minHeight: 44,
};
