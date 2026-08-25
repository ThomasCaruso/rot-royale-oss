/**
 * The Apple and Google marks, for the front door's provider tiles.
 *
 * This file used to hold a full "Continue with Apple / Google" BUTTON plus the shared
 * `AUTH_BUTTON_*` metrics three components had to agree on. All of that is gone: its caller was the
 * provider-choice screen (deleted when the front door's row became the choice), and the last reason
 * to keep it — a live question about whether Google's own rendered button could be made to fit a
 * compact tile — was closed by moving Google to the OIDC authorization-code flow. There is no
 * rendered provider widget anywhere in this app now, so there is nothing left for those metrics to
 * keep in step. What remains is two SVGs and the provider union.
 *
 * The marks do NOT re-skin with the equipped theme, and that is deliberate. Apple and Google both
 * publish branding requirements for sign-in surfaces — the unmodified mark, approved colourways,
 * minimum sizing — and Apple reviews against them. A mark tinted to match the Starter palette would
 * be a rejection.
 *
 * They are inlined as SVG rather than fetched: `public/` assets are not content-hashed
 * (docs/architecture.md §13), a network image would flash on a cold sign-in screen, and these are
 * a dozen paths. They are Apple's and Google's trademarks, reproduced unmodified as their
 * guidelines require for this exact purpose — see THIRD_PARTY_NOTICES.md.
 */

export type SocialProvider = "apple" | "google";

export function AppleMark() {
  return (
    <svg width="18" height="22" viewBox="0 0 14 17" aria-hidden focusable="false">
      <path
        fill="currentColor"
        d="M11.62 8.98c-.02-1.86 1.52-2.76 1.59-2.8-.87-1.27-2.22-1.44-2.7-1.46-1.15-.12-2.24.68-2.83.68-.58 0-1.48-.66-2.43-.64-1.25.02-2.4.73-3.05 1.84-1.3 2.25-.33 5.58.93 7.41.62.9 1.35 1.9 2.31 1.86.93-.04 1.28-.6 2.4-.6 1.12 0 1.44.6 2.42.58 1-.02 1.63-.91 2.24-1.81.71-1.04 1-2.05 1.01-2.1-.02-.01-1.94-.75-1.96-2.96zM9.79 3.5c.51-.62.86-1.49.76-2.35-.74.03-1.63.49-2.16 1.11-.47.55-.89 1.43-.78 2.28.83.06 1.67-.42 2.18-1.04z"
      />
    </svg>
  );
}

/** Exported for the front door's compact provider tile. Google's official four-colour mark. */
export function GoogleMark() {
  return (
    <svg width="19" height="19" viewBox="0 0 18 18" aria-hidden focusable="false">
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18z"
      />
      <path
        fill="#FBBC05"
        d="M3.97 10.72a5.4 5.4 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3.01-2.33z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.32 0 2.5.46 3.44 1.35l2.58-2.58C13.47.9 11.43 0 9 0A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58z"
      />
    </svg>
  );
}

/** Provider-mandated colourways. Not theme tokens — see the note above. */
