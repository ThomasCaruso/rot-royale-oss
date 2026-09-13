/**
 * Sign in with Apple, on the web.
 *
 * The mirror of `googleIdentity.ts`, and the differences are all Apple's.
 *
 * THE CLIENT ID IS A SERVICE ID, not the bundle id. Natively, Apple's audience is the app's bundle
 * id; on the web it is a separate "Services" identifier registered against a verified domain and a
 * Return URL. They are different strings for the same product, which is why the server keeps a LIST
 * of acceptable audiences rather than one value — a token from the app and a token from the website
 * both have to verify.
 *
 * usePopup, not a redirect. A redirect would tear down the SPA mid-sign-in and lose whatever the
 * player was doing; the popup hands the token back in place. Apple still requires the Return URL to
 * be registered and to match exactly, popup or not — hence the explicit `redirectURI`.
 *
 * THE NONCE IS HASHED. Apple puts SHA-256(nonce) in the token, where Google echoes the raw value.
 * The server compares whatever the client says it sent, so this sends the hash — sending the raw
 * value here would make every legitimate Apple sign-in fail the nonce check.
 *
 * Apple sends the email on the FIRST authorization only, and Hide My Email substitutes a relay
 * address. Neither is a problem: the account is keyed on the provider `sub`, never the email.
 */

const SCRIPT_SRC =
  "https://appleid.cdn-apple.com/appleauth/static/jsapi/appleid/1/en_US/appleid.auth.js";
const SCRIPT_ID = "apple-identity-services";

interface AppleAuthApi {
  init: (config: {
    clientId: string;
    scope: string;
    redirectURI: string;
    usePopup: boolean;
    nonce?: string;
    state?: string;
  }) => void;
  signIn: () => Promise<{
    authorization?: { id_token?: string; code?: string; state?: string };
    user?: { name?: { firstName?: string; lastName?: string }; email?: string };
  }>;
}

interface AppleGlobal {
  auth: AppleAuthApi;
}

export class AppleIdentityUnavailable extends Error {
  constructor(message = "Apple sign-in could not be loaded") {
    super(message);
    this.name = "AppleIdentityUnavailable";
  }
}

/** The player closed Apple's popup. A choice, not a failure. */
export class AppleSignInCancelled extends Error {
  constructor() {
    super("cancelled");
    this.name = "AppleSignInCancelled";
  }
}

function existing(): AppleGlobal | null {
  const a = (globalThis as { AppleID?: unknown }).AppleID as AppleGlobal | undefined;
  return a?.auth ? a : null;
}

let pending: Promise<AppleGlobal> | null = null;

/** Load Apple's SDK once, on demand. Concurrent callers share the in-flight load. */
export function loadAppleIdentity(): Promise<AppleGlobal> {
  const already = existing();
  if (already) return Promise.resolve(already);
  if (pending) return pending;

  pending = new Promise<AppleGlobal>((resolve, reject) => {
    if (typeof document === "undefined") {
      reject(new AppleIdentityUnavailable("no document"));
      return;
    }
    const done = () => {
      const a = existing();
      if (a) resolve(a);
      else reject(new AppleIdentityUnavailable());
    };
    const prior = document.getElementById(SCRIPT_ID) as HTMLScriptElement | null;
    if (prior) {
      prior.addEventListener("load", done, { once: true });
      prior.addEventListener("error", () => reject(new AppleIdentityUnavailable()), { once: true });
      return;
    }
    const script = document.createElement("script");
    script.id = SCRIPT_ID;
    script.src = SCRIPT_SRC;
    script.async = true;
    script.defer = true;
    script.addEventListener("load", done, { once: true });
    script.addEventListener("error", () => reject(new AppleIdentityUnavailable()), { once: true });
    document.head.appendChild(script);
  }).catch((err) => {
    // Do not cache the failure — a blocked script or a dropped network should not disable the
    // button for the rest of the session.
    pending = null;
    throw err;
  });

  return pending;
}

function randomNonce(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Run Apple's popup flow and return the identity token plus the nonce form Apple put in it.
 *
 * `redirectURI` must EXACTLY match a Return URL registered on the Service ID — Apple rejects a
 * mismatch outright, and the error it gives is unhelpfully generic. It defaults to this page's
 * origin, which is what the registration should name.
 */
export async function signInWithApple(options: {
  clientId: string;
  redirectURI?: string;
}): Promise<{ idToken: string; nonce: string }> {
  const apple = await loadAppleIdentity();

  const raw = randomNonce();
  const hashed = await sha256Hex(raw);

  apple.auth.init({
    clientId: options.clientId,
    scope: "name email",
    redirectURI: options.redirectURI ?? globalThis.location?.origin ?? "",
    usePopup: true,
    // Apple hashes this into the token; the server is told the same form so the comparison lines up.
    nonce: hashed,
  });

  try {
    const res = await apple.auth.signIn();
    const idToken = res?.authorization?.id_token;
    if (!idToken) throw new AppleSignInCancelled();
    return { idToken, nonce: hashed };
  } catch (err) {
    // Apple reports a closed popup as `popup_closed_by_user`, and a cancelled sheet as
    // `user_cancelled_authorize`. Neither is worth showing as an error.
    const code = String(
      (err as { error?: string })?.error ?? (err as { message?: string })?.message ?? err ?? ""
    ).toLowerCase();
    if (code.includes("cancel") || code.includes("closed") || code.includes("popup")) {
      throw new AppleSignInCancelled();
    }
    throw err instanceof Error ? err : new Error(String(err));
  }
}

/**
 * The NATIVE Sign in with Apple flow (iOS), using ASAuthorization through the Capacitor plugin.
 *
 * WHY A SECOND FUNCTION RATHER THAN A BRANCH INSIDE THE WEB ONE. They share the nonce contract and
 * nothing else. The web flow loads Apple's JS SDK, needs a Service ID and a Return URL registered
 * against it, and opens a popup; the native flow loads no script, takes no redirect URI, and is
 * presented by the OS. Folding them together would mean a function whose two halves share one line.
 *
 * THE AUDIENCE IS DIFFERENT, AND THIS IS THE PART THAT BITES. A token minted natively carries the
 * app's BUNDLE ID (live.rotroyale.app) as its audience, not the Service ID (live.rotroyale.web) the
 * website uses. Both are valid audiences for the same product, which is exactly why the server keeps
 * `APPLE_CLIENT_IDS` as a LIST — but the bundle id has to actually BE in that list or every native
 * sign-in fails verification with a correct-looking token.
 *
 * The nonce convention is IDENTICAL to the web flow deliberately: hand Apple the hash, report the
 * hash, because the server compares the token's `nonce` claim against whatever the client says it
 * sent. Two different conventions for one endpoint would be a bug waiting to happen.
 */
export async function signInWithAppleNative(): Promise<{ idToken: string; nonce: string }> {
  const { SignInWithApple } = await import("@capacitor-community/apple-sign-in");

  const hashed = await sha256Hex(randomNonce());
  try {
    const res = await SignInWithApple.authorize({
      // Both are required by the plugin's type and IGNORED by iOS, which authorizes against the
      // bundle id from the entitlement. They matter only to the plugin's Android/web fallbacks,
      // which this app does not use.
      clientId: "",
      redirectURI: "",
      scopes: "email name",
      nonce: hashed,
    });
    const idToken = res?.response?.identityToken;
    if (!idToken) throw new AppleSignInCancelled();
    return { idToken, nonce: hashed };
  } catch (err) {
    // ASAuthorizationError.canceled is 1001. The plugin surfaces it as a message rather than a
    // typed code, so both are checked — a cancelled sheet is a normal outcome, never an error.
    const text = String(
      (err as { code?: string | number })?.code ?? (err as { message?: string })?.message ?? err ?? ""
    ).toLowerCase();
    if (text.includes("1001") || text.includes("cancel") || text.includes("abort")) {
      throw new AppleSignInCancelled();
    }
    throw err instanceof Error ? err : new Error(String(err));
  }
}
