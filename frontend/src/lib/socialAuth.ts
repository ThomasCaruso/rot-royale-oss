/**
 * Getting an Apple/Google ID token from the device, so the server can verify it.
 *
 * The seam matters more than either implementation. On NATIVE the sign-in must go through the
 * platform sheet — Apple's ASAuthorization, Google's account picker — because a web OAuth popup
 * inside a WKWebView is both a poor experience and an App Store review problem. On the WEB it is
 * the providers' JavaScript SDKs. Same return shape either way, so the screen never branches.
 *
 * We never see a password here, and never hold a provider secret. The device authenticates the
 * person with the provider; all that crosses to our server is a short-lived signed assertion, which
 * `backend/app/core/socialid.py` verifies against the provider's public keys.
 *
 * NONCE. Generated here, sent to the provider, and echoed back inside the signed token — the server
 * then checks it matches. That is what stops a token captured from one sign-in being replayed to
 * authenticate a different one, so it is generated per attempt and never reused.
 */

export type SocialProvider = "apple" | "google";

export interface SocialCredential {
  provider: SocialProvider;
  idToken: string;
  nonce: string;
}

/** The player closed the sheet. Not an error to report — they chose to stop. */
export class SocialSignInCancelled extends Error {
  constructor() {
    super("cancelled");
    this.name = "SocialSignInCancelled";
  }
}

export class SocialSignInUnavailable extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SocialSignInUnavailable";
  }
}

function randomNonce(): string {
  // crypto.getRandomValues, not Math.random: this value is the replay protection, so it has to be
  // unpredictable rather than merely unique.
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Apple requires the nonce to be sent SHA-256 hashed, and returns the hash inside the token.
 * Google echoes the raw value. The caller therefore sends whichever form the provider will have
 * put in the token — otherwise the server's comparison fails for a completely legitimate sign-in.
 */
async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Load a native plugin that may not be installed in this build.
 *
 * The specifier is a VARIABLE so TypeScript does not try to resolve it and the web bundle never
 * references native-only packages. That is what lets the app compile, test and ship on the web
 * before the Capacitor plugins are added — the provider simply reports itself unavailable instead
 * of the whole module failing to load. `@vite-ignore` keeps the bundler from trying to follow it.
 */
async function loadPlugin<T>(specifier: string): Promise<T | null> {
  try {
    return (await import(/* @vite-ignore */ specifier)) as T;
  } catch {
    return null;
  }
}

function isNative(): boolean {
  const cap = (globalThis as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
  return typeof cap?.isNativePlatform === "function" ? cap.isNativePlatform() : false;
}

/**
 * Ask the platform for a credential.
 *
 * Native uses the Capacitor plugins; they are loaded with a dynamic import so the web bundle never
 * pulls in native-only code, and so a build without the plugin installed still compiles and simply
 * reports the provider as unavailable rather than failing at module load.
 */
export async function signInWith(provider: SocialProvider): Promise<SocialCredential> {
  const rawNonce = randomNonce();

  if (isNative()) {
    return provider === "apple"
      ? await appleNative(rawNonce)
      : await googleNative();
  }
  return provider === "apple" ? await appleWeb(rawNonce) : await googleWeb(rawNonce);
}

async function appleNative(rawNonce: string): Promise<SocialCredential> {
  type ApplePlugin = {
    SignInWithApple: {
      authorize: (o: unknown) => Promise<{ response?: { identityToken?: string } }>;
    };
  };
  const mod = await loadPlugin<ApplePlugin>("@capacitor-community/apple-sign-in");
  if (!mod) throw new SocialSignInUnavailable("Apple sign-in is not available in this build");
  try {
    const res = await mod.SignInWithApple.authorize({
      clientId: import.meta.env.VITE_APPLE_CLIENT_ID ?? "",
      redirectURI: "",
      scopes: "email name",
      // Apple hashes the nonce into the token, so we hand it the hash and compare the same form.
      nonce: await sha256Hex(rawNonce),
    });
    const idToken = res.response?.identityToken;
    if (!idToken) throw new SocialSignInCancelled();
    return { provider: "apple", idToken, nonce: await sha256Hex(rawNonce) };
  } catch (err) {
    throw normaliseCancel(err);
  }
}

async function googleNative(): Promise<SocialCredential> {
  type GooglePlugin = {
    GoogleAuth: { signIn: () => Promise<{ authentication?: { idToken?: string } }> };
  };
  const mod = await loadPlugin<GooglePlugin>("@codetrix-studio/capacitor-google-auth");
  if (!mod) throw new SocialSignInUnavailable("Google sign-in is not available in this build");
  try {
    const res = await mod.GoogleAuth.signIn();
    const idToken = res?.authentication?.idToken;
    if (!idToken) throw new SocialSignInCancelled();
    // The plugin does not thread a nonce through, so none is claimed. The server treats a missing
    // nonce as "the client did not commit to one" and skips that check rather than failing —
    // asserting a nonce we did not actually send would reject every real sign-in.
    return { provider: "google", idToken, nonce: "" };
  } catch (err) {
    throw normaliseCancel(err);
  }
}

async function appleWeb(rawNonce: string): Promise<SocialCredential> {
  const appleId = (globalThis as { AppleID?: unknown }).AppleID as
    | { auth: { signIn: (o: unknown) => Promise<{ authorization?: { id_token?: string } }> } }
    | undefined;
  if (!appleId) throw new SocialSignInUnavailable("Apple sign-in is not loaded");
  const hashed = await sha256Hex(rawNonce);
  try {
    const res = await appleId.auth.signIn({ nonce: hashed });
    const idToken = res?.authorization?.id_token;
    if (!idToken) throw new SocialSignInCancelled();
    return { provider: "apple", idToken, nonce: hashed };
  } catch (err) {
    throw normaliseCancel(err);
  }
}

async function googleWeb(rawNonce: string): Promise<SocialCredential> {
  const google = (globalThis as { google?: unknown }).google as
    | {
        accounts: {
          id: {
            initialize: (o: unknown) => void;
            prompt: () => void;
          };
        };
      }
    | undefined;
  if (!google) throw new SocialSignInUnavailable("Google sign-in is not loaded");
  const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;
  if (!clientId) throw new SocialSignInUnavailable("Google sign-in is not configured");

  return await new Promise<SocialCredential>((resolve, reject) => {
    google.accounts.id.initialize({
      client_id: clientId,
      nonce: rawNonce,
      callback: (res: { credential?: string }) => {
        if (!res?.credential) return reject(new SocialSignInCancelled());
        resolve({ provider: "google", idToken: res.credential, nonce: rawNonce });
      },
    });
    google.accounts.id.prompt();
  });
}

/** Every provider spells "the user closed the sheet" differently; none of them is a real failure. */
function normaliseCancel(err: unknown): Error {
  const text = String((err as { message?: string })?.message ?? err ?? "").toLowerCase();
  if (
    text.includes("cancel") ||
    text.includes("closed") ||
    text.includes("popup_closed") ||
    text.includes("1001") // ASAuthorizationError.canceled
  ) {
    return new SocialSignInCancelled();
  }
  return err instanceof Error ? err : new Error(String(err));
}
