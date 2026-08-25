import { type FormEvent, type ReactNode, useState } from "react";
import { login, registerAndLogin } from "@/api/session";
import { Display } from "@/ui/Display";
import { EyeIcon, EyeOffIcon, LockIcon, MailIcon, UserIcon } from "@/ui/icons";
import { useT } from "@/i18n/useT";
import { errorMessage } from "@/i18n/errors";

type Mode = "login" | "register";

/**
 * STEP 2 of the sign-in flow — email / password, reached from the provider-choice screen's
 * the front door's Email tile (see screens/brainboost/ReturningUserRow).
 *
 * This is the SAME form that used to sit under the social buttons on one long screen; only its
 * placement changed. The two-step split exists so the front door is three equally weighted choices
 * and nothing else — a form under them makes email look like the default and the providers look
 * like an afterthought. `login` / `registerAndLogin` are untouched, so every live email account
 * signs in exactly as before.
 *
 * The field visuals (surface, focus ring, placeholder, autofill, disabled, error) live in the
 * `.rr-auth-input` CSS block (theme/global.css) — inline styles can't reach ::placeholder or
 * :-webkit-autofill, and the old flat semi-transparent fill read as a disabled gray. Layout-only
 * bits (icon insets) stay inline here.
 */
function Field({
  leading,
  trailing,
  invalid,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & {
  leading: ReactNode;
  trailing?: ReactNode;
  invalid?: boolean;
}) {
  return (
    <div className="rr-auth-field" style={{ position: "relative", display: "flex", alignItems: "center" }}>
      <span
        className="rr-auth-lead"
        aria-hidden
        style={{
          position: "absolute",
          left: 15,
          display: "flex",
          color: "var(--faint)",
          pointerEvents: "none",
          transition: "color 140ms ease",
        }}
      >
        {leading}
      </span>
      <input
        {...props}
        aria-invalid={invalid || undefined}
        className="rr-auth-input"
        style={{ paddingLeft: 44, paddingRight: trailing ? 46 : 16 }}
      />
      {trailing}
    </div>
  );
}

export function EmailAuthForm({ onBack }: { onBack?: () => void } = {}) {
  const t = useT();
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (mode === "register") await registerAndLogin(email.trim(), username.trim(), password);
      else await login(email.trim(), password);
    } catch (err) {
      setError(errorMessage(err, t, t.auth.somethingWentWrong));
      setBusy(false);
    }
  }

  return (
    <main
      style={{
        minHeight: "100dvh",
        maxWidth: 380,
        margin: "0 auto",
        // Top-anchored (not centred) so the form stays above the keyboard on short screens, with a
        // comfortable offset on tall ones. The form is short — no scrolling on a phone.
        padding: "calc(env(safe-area-inset-top) + 9vh) 24px calc(env(safe-area-inset-bottom) + 28px)",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <header style={{ textAlign: "center", marginBottom: 30 }}>
        <Display style={{ fontSize: 33, letterSpacing: "-0.02em", lineHeight: 1.05 }}>Rot Royale</Display>
        <div style={{ color: "var(--muted)", fontWeight: 500, fontSize: 14.5, marginTop: 9, lineHeight: 1.4 }}>
          {t.auth.tagline}
        </div>
      </header>

      {/* Segmented control — a recessed hairline track with a single raised active segment. Minimal
          weight: one soft shadow + the specular edge, not a heavy pill. NOT className="display" (the
          mono skin turns every .display button into a solid CTA, which would flatten both segments). */}
      <div
        role="tablist"
        aria-label={`${t.auth.login} / ${t.auth.signUp}`}
        style={{
          display: "flex",
          gap: 4,
          padding: 4,
          borderRadius: "var(--radius-pill, 14px)",
          background: "color-mix(in srgb, var(--panel2) 70%, var(--panel))",
          border: "1px solid var(--line)",
          boxShadow: "inset 0 1px 2px color-mix(in srgb, var(--brand) 6%, transparent)",
          marginBottom: 22,
        }}
      >
        {(["login", "register"] as const).map((m) => {
          const active = mode === m;
          return (
            <button
              key={m}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => {
                setMode(m);
                setError(null);
              }}
              style={{
                flex: 1,
                padding: "10px 0",
                borderRadius: "calc(var(--radius-pill, 14px) - 4px)",
                border: active ? "1px solid var(--line)" : "1px solid transparent",
                cursor: active ? "default" : "pointer",
                fontSize: 14,
                fontWeight: active ? 700 : 600,
                fontFamily: "inherit",
                background: active ? "var(--panel)" : "transparent",
                color: active ? "var(--text)" : "var(--muted)",
                boxShadow: active ? "inset 0 1px 0 var(--sheen), 0 1px 2px rgba(17,17,17,.10)" : "none",
                transition: "background 140ms, color 140ms, box-shadow 140ms",
              }}
            >
              {m === "login" ? t.auth.login : t.auth.signUp}
            </button>
          );
        })}
      </div>

      <form onSubmit={onSubmit} style={{ display: "flex", flexDirection: "column", gap: 11 }}>
        <Field
          type="email"
          placeholder={t.auth.email}
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          invalid={Boolean(error)}
          leading={<MailIcon size={18} />}
        />
        {mode === "register" && (
          <Field
            type="text"
            placeholder={t.auth.username}
            autoComplete="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
            minLength={3}
            maxLength={32}
            invalid={Boolean(error)}
            leading={<UserIcon size={18} />}
          />
        )}
        <Field
          type={showPassword ? "text" : "password"}
          placeholder={t.auth.password}
          autoComplete={mode === "register" ? "new-password" : "current-password"}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          minLength={8}
          invalid={Boolean(error)}
          leading={<LockIcon size={18} />}
          trailing={
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              aria-label={showPassword ? t.auth.hidePassword : t.auth.showPassword}
              aria-pressed={showPassword}
              style={{
                position: "absolute",
                right: 6,
                display: "grid",
                placeItems: "center",
                width: 34,
                height: 34,
                borderRadius: 10,
                border: "none",
                background: "transparent",
                color: "var(--faint)",
                cursor: "pointer",
                transition: "color 140ms ease",
              }}
              onPointerEnter={(e) => (e.currentTarget.style.color = "var(--brand)")}
              onPointerLeave={(e) => (e.currentTarget.style.color = "var(--faint)")}
            >
              {showPassword ? <EyeOffIcon size={18} /> : <EyeIcon size={18} />}
            </button>
          }
        />

        {error && (
          <div
            role="alert"
            style={{ color: "var(--pink)", fontSize: 13.5, fontWeight: 600, paddingLeft: 2, marginTop: 1 }}
          >
            {error}
          </div>
        )}

        {/* Primary action — the app's signature purple CTA pill (same treatment as the Brain Boost
            intro's CTA): tucked directional shadow for weight, no glow, no idle pulse. */}
        <button
          type="submit"
          disabled={busy}
          style={{
            width: "100%",
            height: 56,
            marginTop: 14,
            borderRadius: 999,
            border: "1px solid color-mix(in srgb, var(--brand) 24%, transparent)",
            background: "var(--cta)",
            color: "var(--ctaText)",
            fontFamily: "inherit",
            fontSize: 15,
            fontWeight: 700,
            letterSpacing: "0.16em",
            textIndent: "0.16em",
            textTransform: "uppercase",
            cursor: busy ? "default" : "pointer",
            opacity: busy ? 0.7 : 1,
            // A tucked, seated shadow — not a glow. A tight contact line directly under the pill
            // plus one restrained directional cast, both pulled in by a negative spread so it reads
            // as weight on the page rather than a haze around it.
            boxShadow:
              "0 10px 20px -12px rgba(92,54,172,.42), 0 2px 5px -2px rgba(52,28,104,.30)," +
              " inset 0 1px 0 rgba(255,255,255,.20)",
            transition: "transform 90ms ease, opacity 140ms ease",
          }}
          onPointerDown={(e) => {
            if (!busy) e.currentTarget.style.transform = "translateY(1px)";
          }}
          onPointerUp={(e) => (e.currentTarget.style.transform = "translateY(0)")}
          onPointerLeave={(e) => (e.currentTarget.style.transform = "translateY(0)")}
        >
          {busy ? "…" : mode === "login" ? t.auth.logInCta : t.auth.createAccountCta}
        </button>
      </form>

      {onBack && (
        <button
          type="button"
          onClick={onBack}
          style={{
            background: "none",
            border: "none",
            color: "var(--muted)",
            fontWeight: 600,
            fontSize: 13.5,
            fontFamily: "inherit",
            cursor: "pointer",
            padding: "12px 8px",
            marginTop: 20,
            alignSelf: "center",
          }}
        >
          ‹ {t.common.back}
        </button>
      )}
    </main>
  );
}
