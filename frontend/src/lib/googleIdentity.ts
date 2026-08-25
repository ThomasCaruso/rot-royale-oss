/**
 * Google Identity Services on the web.
 *
 * Two decisions here are worth the words.
 *
 * THE SCRIPT IS LOADED ON DEMAND, not from index.html. It is only needed on the sign-in screen,
 * which most sessions never see — a guest taps straight into the daily — and putting a
 * third-party script on the cold-start path costs every player a request and hands Google a
 * pageview for people who never asked to sign in. It is fetched when the sign-in screen learns
 * Google is actually configured, and never otherwise.
 *
 * WE USE GOOGLE'S RENDERED BUTTON, not our own with `prompt()` behind it. `google.accounts.id
 * .prompt()` is One Tap, and Google suppresses it after a couple of dismissals, in incognito, and
 * for anyone who opted out — so a custom button wired to it does nothing at all for a meaningful
 * share of players, silently, with no error to report. `renderButton` is the supported path for
 * getting an ID token from a click, and it is brand-compliant by construction, which is its own
 * small win: Apple and Google both police their sign-in buttons.
 *
 * No secret is involved. The client id is public by design — it travels in the OAuth flow and is
 * visible in the page source. The private half of the credential lives at Google and never here.
 */

const SCRIPT_SRC = "https://accounts.google.com/gsi/client";
const SCRIPT_ID = "google-identity-services";

export interface GoogleCredentialResponse {
  credential?: string;
}

interface GoogleIdApi {
  initialize: (config: {
    client_id: string;
    callback: (response: GoogleCredentialResponse) => void;
    nonce?: string;
    auto_select?: boolean;
    cancel_on_tap_outside?: boolean;
    use_fedcm_for_prompt?: boolean;
  }) => void;
  renderButton: (parent: HTMLElement, options: Record<string, unknown>) => void;
  cancel: () => void;
}

interface GoogleAccountsGlobal {
  accounts: { id: GoogleIdApi };
}

export class GoogleIdentityUnavailable extends Error {
  constructor(message = "Google sign-in could not be loaded") {
    super(message);
    this.name = "GoogleIdentityUnavailable";
  }
}

function existing(): GoogleAccountsGlobal | null {
  const g = (globalThis as { google?: unknown }).google as GoogleAccountsGlobal | undefined;
  return g?.accounts?.id ? g : null;
}

let pending: Promise<GoogleAccountsGlobal> | null = null;

/** Load the SDK once. Concurrent callers share the same in-flight load. */
export function loadGoogleIdentity(): Promise<GoogleAccountsGlobal> {
  const already = existing();
  if (already) return Promise.resolve(already);
  if (pending) return pending;

  pending = new Promise<GoogleAccountsGlobal>((resolve, reject) => {
    if (typeof document === "undefined") {
      reject(new GoogleIdentityUnavailable("no document"));
      return;
    }
    const done = () => {
      const g = existing();
      // The script can load and still not expose the API — a blocked or truncated response. Treat
      // that as unavailable rather than letting `google.accounts.id` throw somewhere later.
      if (g) resolve(g);
      else reject(new GoogleIdentityUnavailable());
    };

    const prior = document.getElementById(SCRIPT_ID) as HTMLScriptElement | null;
    if (prior) {
      prior.addEventListener("load", done, { once: true });
      prior.addEventListener(
        "error",
        () => reject(new GoogleIdentityUnavailable()),
        { once: true }
      );
      return;
    }

    const script = document.createElement("script");
    script.id = SCRIPT_ID;
    script.src = SCRIPT_SRC;
    script.async = true;
    script.defer = true;
    script.addEventListener("load", done, { once: true });
    script.addEventListener("error", () => reject(new GoogleIdentityUnavailable()), { once: true });
    document.head.appendChild(script);
  }).catch((err) => {
    // Let a later attempt retry rather than caching the failure forever — an ad blocker may be
    // switched off, or the network may come back, and the player will simply press again.
    pending = null;
    throw err;
  });

  return pending;
}

/**
 * Render Google's official button into `parent` and hand back the ID token it produces.
 *
 * `width` is passed so the button matches the CTA it sits above; GIS takes a pixel number and
 * clamps it to its own supported range, which is why the caller measures rather than guessing.
 */
export async function renderGoogleButton(options: {
  parent: HTMLElement;
  clientId: string;
  /** Pixel width for the standard pill. Ignored for `type: "icon"`, which is a fixed square. */
  width?: number;
  /**
   * GIS button type. "standard" is the wide pill the sign-in stack uses; "icon" is a square with
   * only the G mark, which is what the front door's compact provider tile needs. Google's own
   * button either way — a custom control cannot reach an ID token except through One Tap, which
   * Google suppresses for a real share of players.
   */
  type?: "standard" | "icon";
  shape?: "pill" | "circle" | "square" | "rectangular";
  onCredential: (idToken: string) => void;
  onError: (err: unknown) => void;
  text?: "signin_with" | "continue_with";
}): Promise<void> {
  const google = await loadGoogleIdentity();
  google.accounts.id.initialize({
    client_id: options.clientId,
    // No nonce. GIS does not thread one through `renderButton`, and claiming a nonce we never sent
    // would make the server reject every legitimate sign-in. The server treats a missing nonce as
    // "the client did not commit to one" and skips that check; the audience, issuer and signature
    // checks all still apply.
    callback: (response) => {
      if (response?.credential) options.onCredential(response.credential);
      else options.onError(new GoogleIdentityUnavailable("no credential returned"));
    },
    // Never sign someone in without them asking. auto_select would resurrect a previous session
    // silently on a screen whose entire purpose is an explicit choice.
    auto_select: false,
    cancel_on_tap_outside: true,
  });
  options.parent.replaceChildren();
  // GIS owns these pixels — the colourway and mark are Google's to dictate. What it DOES expose is
  // shape and alignment, and both are set to match the sign-in stack around it (ui/SocialButton's
  // `AUTH_BUTTON_*`): `pill` because the app's own CTA is a fully rounded pill and GIS's only other
  // option is a 4px rectangle, and `logo_alignment: center` because the Apple and email buttons
  // either side centre their [mark, label] pair. It was `left` while this button sat above an email
  // FORM and only had to look like a provider button; now it is one of three equal choices, and a
  // mark pinned to the left edge is the one thing that breaks the set.
  google.accounts.id.renderButton(options.parent, {
    type: options.type ?? "standard",
    theme: "outline",
    size: "large",
    shape: options.shape ?? "pill",
    logo_alignment: "center",
    text: options.text ?? "continue_with",
    // GIS rejects `width` on an icon button (it is a fixed square), so it is only sent for the
    // standard pill.
    ...(options.type === "icon" ? {} : { width: options.width }),
  });
}
