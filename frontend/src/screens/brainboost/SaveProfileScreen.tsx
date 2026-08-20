/**
 * "Save your Brain Profile" — the guest → account upgrade, framed as saving earned progress,
 * never as a SaaS signup. Email + username + password (no confirm-password wall). Skippable: the
 * guest keeps playing either way.
 *
 * The username is PRE-FILLED with the auto-generated handle the player has been playing under, so
 * keeping it costs nothing and the field stays a one-tap step rather than a signup wall. It is
 * editable because this is the moment the name stops being throwaway: it becomes the name on the
 * leaderboard, on shared results, and the handle friends add them by.
 */

import { useEffect, useState, type FormEvent } from "react";
import { upgradeAccount } from "@/api/session";
import { useT } from "@/i18n/useT";
import { trackFunnel, type FunnelSource } from "@/lib/analytics";
import { useAiReady } from "@/lib/useAiReady";
import { useSessionStore } from "@/store/session";
import { Display } from "@/ui/Display";
import { GlassCard } from "@/ui/GlassCard";
import { GoldButton } from "@/ui/GoldButton";
import { errorMessage } from "@/i18n/errors";

const input: React.CSSProperties = {
  width: "100%",
  padding: "13px 14px",
  borderRadius: 14,
  border: "1px solid var(--line)",
  background: "var(--panel)",
  color: "var(--text)",
  fontSize: 15,
  outline: "none",
};

export function SaveProfileScreen({
  onDone,
  onSkip,
  title,
  subtitle,
  skipLabel,
  source = "reveal",
}: {
  onDone: () => void;
  onSkip: () => void;
  // Context overrides (e.g. the ranked gate reframes the same screen around a fresh score).
  title?: string;
  subtitle?: string;
  skipLabel?: string;
  source?: FunnelSource; // where this save screen was opened from (funnel analytics)
}) {
  const t = useT();
  const aiReady = useAiReady();
  const username = useSessionStore((s) => s.me?.username);
  const [email, setEmail] = useState("");
  const [handle, setHandle] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Pre-fill the username with the handle the player has already been playing under, once the
  // session loads. They can keep it with zero effort or change it here — this is the only moment
  // in the flow where the name they'll appear under on the leaderboard is worth a decision.
  // Guarded so it never overwrites something the player has started typing.
  useEffect(() => {
    if (username) setHandle((current) => current || username);
  }, [username]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await upgradeAccount(email.trim(), password, handle.trim());
      trackFunnel("upgrade_completed", source);
      onDone();
    } catch (err) {
      setError(errorMessage(err, t, t.auth.somethingWentWrong));
      setBusy(false);
    }
  }

  return (
    <main
      style={{
        minHeight: "100dvh",
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        gap: 16,
        padding:
          "calc(24px + env(safe-area-inset-top)) clamp(20px, 6vw, 30px) calc(30px + env(safe-area-inset-bottom))",
        maxWidth: 430,
        margin: "0 auto",
        textAlign: "center",
      }}
    >
      <Display pop style={{ fontSize: 34, lineHeight: 1.1 }}>
        {title ?? t.brainBoost.saveTitle}
      </Display>
      <div style={{ fontSize: 14.5, color: "var(--muted)", lineHeight: 1.5 }}>
        {subtitle ??
          (aiReady ? t.brainBoost.saveSubReady : t.brainBoost.saveSub)}
      </div>

      <GlassCard style={{ padding: 18 }}>
        <form
          onSubmit={(e) => void onSubmit(e)}
          style={{ display: "flex", flexDirection: "column", gap: 10 }}
        >
          <input
            style={input}
            type="email"
            required
            autoFocus
            autoComplete="email"
            inputMode="email"
            enterKeyHint="next"
            placeholder={t.auth.email}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          {/* Username sits between email and password so a password manager sees the usual
              email → username → new-password order and offers to save the whole credential. */}
          <input
            style={input}
            type="text"
            required
            minLength={3}
            maxLength={32}
            autoComplete="username"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="next"
            placeholder={t.auth.username}
            value={handle}
            onChange={(e) => setHandle(e.target.value)}
          />
          <input
            style={input}
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
            enterKeyHint="done"
            placeholder={t.auth.password}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          {error && (
            <div
              style={{ color: "var(--pink)", fontSize: 13, fontWeight: 700 }}
            >
              {error}
            </div>
          )}
          <GoldButton type="submit" disabled={busy}>
            {busy ? "…" : t.brainBoost.saveCta}
          </GoldButton>
        </form>
      </GlassCard>

      <button
        type="button"
        onClick={onSkip}
        style={{
          background: "none",
          border: "none",
          color: "var(--muted)",
          fontWeight: 700,
          fontSize: 13.5,
          cursor: "pointer",
          padding: 8,
        }}
      >
        {skipLabel ?? t.brainBoost.notNow}
      </button>
    </main>
  );
}
