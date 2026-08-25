import { type CSSProperties } from "react";
import { useSocialSignIn } from "@/lib/useSocialSignIn";
import { useT } from "@/i18n/useT";
import { AppleMark, GoogleMark } from "@/ui/SocialButton";
import { MailIcon } from "@/ui/icons";

/**
 * The returning-player row on the Daily Royale front door: `Already playing?` and three compact
 * provider tiles.
 *
 * THE POINT OF THIS COMPONENT IS THAT IT LOSES. A brand-new visitor must read PLAY DAILY ROYALE as
 * the only thing on the screen worth tapping; this row exists for the minority who already have an
 * account. So the tiles are small, low-contrast, unfilled, and sit below the fold of attention —
 * the full-width black/white/lavender provider buttons belong on the dedicated sign-in screen,
 * where choosing a provider IS the task. Anything here that starts competing with the CTA (more
 * fill, more shadow, more size) is a regression, not a polish.
 *
 * No auth logic of its own: providers and both handlers come from `useSocialSignIn`, the same hook
 * the sign-in screen uses, and Email routes to that screen's existing email step rather than
 * growing a second form.
 *
 * **All three tiles are now ordinary buttons, and that is the recent, hard-won part.** Google's used
 * to draw our mark with GOOGLE'S OWN button invisible on top of it, because Google Identity Services
 * only hands over a credential from a button it rendered itself, inside a cross-origin iframe. The
 * control the player saw was not the control they pressed, and it behaved accordingly: taps that did
 * nothing, a scaled overlay that swallowed the neighbouring Apple tile's hit area, and a class of
 * bug that could only be debugged through an iframe we cannot see into. Google now runs the OIDC
 * authorization-code flow (`/auth/google/start`), so the tile just navigates. If anyone is ever
 * tempted to reintroduce a rendered provider widget here, that is the history.
 */
export function ReturningUserRow({
  onEmail,
  style,
}: {
  /** Opens the dedicated sign-in screen directly on its email step. */
  onEmail: () => void;
  style?: CSSProperties;
}) {
  const t = useT();
  const {
    showApple,
    showGoogle,
    appleClientId,
    appleRedirectUri,
    socialBusy,
    error,
    notice,
    onApple,
    onGoogle,
  } = useSocialSignIn(t);

  const busy = socialBusy !== null;
  // Email is always offered; the two social tiles only appear where the server can verify them, so
  // this row is never a set of dead controls. `key` drives the stagger below.
  const tiles: { key: string; delay: number; node: React.ReactNode }[] = [];

  if (showApple && appleClientId) {
    tiles.push({
      key: "apple",
      delay: 0,
      node: (
        <Tile
          label={t.brainBoost.providerApple}
          busy={busy}
          onClick={() => void onApple(appleClientId, appleRedirectUri)}
        >
          <AppleMark />
        </Tile>
      ),
    });
  }
  if (showGoogle) {
    tiles.push({
      key: "google",
      delay: 70,
      node: (
        <Tile label={t.brainBoost.providerGoogle} busy={busy} onClick={() => void onGoogle()}>
          <GoogleMark />
        </Tile>
      ),
    });
  }
  tiles.push({
    key: "email",
    delay: tiles.length * 70,
    node: (
      <Tile label={t.brainBoost.providerEmail} busy={busy} onClick={onEmail} tint>
        <MailIcon size={21} />
      </Tile>
    ),
  });

  return (
    <div style={{ ...style }}>
      <div style={prompt} className="rr-login-in">
        {t.brainBoost.haveAccount}
      </div>
      <div style={row}>
        {tiles.map((tile) => (
          <div
            key={tile.key}
            style={{ ...cell, animationDelay: `${900 + tile.delay}ms` }}
            className="rr-login-in"
          >
            {tile.node}
          </div>
        ))}
      </div>
      {error && (
        <div role="alert" style={errorLine}>
          {error}
        </div>
      )}
      {/* NOT an error: linking this provider retired the account's old password. It has to be said
          somewhere, or the player finds out at a later login with no idea why it stopped working.
          This row is the only place it can be said now — it used to live on the sign-in screen,
          whose provider step no longer exists. `role="status"`, not `alert`: it is information. */}
      {notice && (
        <div role="status" style={noticeLine}>
          {notice}
        </div>
      )}
    </div>
  );
}

/** One provider tile: icon in a soft square, provider name beneath it. */
function Tile({
  label,
  busy,
  onClick,
  tint,
  children,
}: {
  label: string;
  busy: boolean;
  onClick: () => void;
  /** The email tile takes the faintest wash of brand purple; the two social ones stay ivory. */
  tint?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      aria-label={label}
      style={tileButton(busy, tint)}
      className="rr-grow"
      // Pointer DOWN, so the give lands with the finger rather than after the click resolves (§7b1).
      // The VARIABLE, not `transform`: .rr-grow composes press with hover, and an inline transform
      // would outrank the :hover rule and disable the grow after the first tap (see global.css).
      {...pressProps(busy)}
    >
      <span style={tileIcon} aria-hidden>
        {children}
      </span>
      <span style={tileLabel}>{label}</span>
    </button>
  );
}

/**
 * The press half of `.rr-grow` (global.css): sets the --rr-press custom property so hover and press
 * MULTIPLY. Writing `style.transform` directly instead — the obvious version — wins the cascade over
 * the :hover rule and silently kills the hover grow from the first release onward.
 *
 * Shared so Google's tile presses identically to its two neighbours despite not being a <button>.
 */
function pressProps(busy: boolean) {
  return {
    onPointerDown: (e: React.PointerEvent<HTMLElement>) =>
      !busy && e.currentTarget.style.setProperty("--rr-press", "0.965"),
    onPointerUp: (e: React.PointerEvent<HTMLElement>) => e.currentTarget.style.removeProperty("--rr-press"),
    onPointerLeave: (e: React.PointerEvent<HTMLElement>) => e.currentTarget.style.removeProperty("--rr-press"),
  };
}

const prompt: CSSProperties = {
  textAlign: "center",
  // A touch darker than `--faint`, a touch lighter than the reassurance above it: this should be
  // legible at a glance without pulling rank on the play flow. The tiles stay quiet.
  color: "color-mix(in srgb, var(--muted) 60%, var(--faint))",
  fontSize: 12.5,
  fontWeight: 600,
  marginBottom: 13,
};

const row: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(3, 1fr)",
  gap: 10,
  maxWidth: 290,
  margin: "0 auto",
};

const cell: CSSProperties = { minWidth: 0 };

/* Deliberately quiet: an ivory surface a shade off the page, a hairline border, and one soft
 * shadow. No fill, no brand colour, no weight — the CTA above owns all of that. */
function tileButton(busy: boolean, tint?: boolean): CSSProperties {
  return {
    width: "100%",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
    padding: "10px 4px 8px",
    borderRadius: 16,
    border: "1px solid color-mix(in srgb, var(--brand) 13%, transparent)",
    // ONE surface for all three. Email used to take a lavender wash over the white panel, which
    // made it brighter than its neighbours and read as the primary of the row — exactly backwards,
    // since it is the only one that then asks for a password. The provider colour now lives in the
    // glyph alone, which is where the recognisability actually is.
    background: "color-mix(in srgb, var(--panel) 92%, var(--bg))",
    color: tint ? "var(--brand)" : "var(--text)",
    boxShadow: "0 2px 6px -2px rgba(84,64,120,.14)",
    cursor: busy ? "default" : "pointer",
    opacity: busy ? 0.55 : 1,
    // No `transition` — .rr-grow owns transform/box-shadow/opacity together; an inline shorthand
    // would replace that declaration and the hover grow would snap (see global.css).
    fontFamily: "inherit",
    WebkitTapHighlightColor: "transparent",
  };
}

const tileIcon: CSSProperties = {
  height: 26,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
};

const tileLabel: CSSProperties = {
  fontSize: 11.5,
  fontWeight: 600,
  letterSpacing: "0.01em",
  color: "var(--muted)",
};

const errorLine: CSSProperties = {
  marginTop: 8,
  textAlign: "center",
  color: "var(--pink)",
  fontSize: 12,
  fontWeight: 600,
};

const noticeLine: CSSProperties = { ...errorLine, color: "var(--muted)" };
