import { useEffect, useRef, useState } from "react";
import { renderGoogleButton } from "@/lib/googleIdentity";

/**
 * "Continue with Google" — Google's own rendered button.
 *
 * Deliberately not our `SocialButton`. A custom button can only produce an ID token via One Tap
 * (`prompt()`), which Google suppresses after a couple of dismissals, in incognito, and for anyone
 * who opted out — so it would silently do nothing for a real share of players. `renderButton` is
 * the supported path for a click, and it is brand-compliant by construction.
 *
 * The cost is that GIS owns the pixels. It is sized to the container so it lines up with the CTA
 * below it, and the surrounding stack supplies the spacing.
 *
 * If it cannot load — blocked script, offline, ad blocker — the component renders NOTHING and tells
 * the parent. The email form is right there, and a broken button is worse than no button.
 */
export function GoogleSignInButton({
  clientId,
  onCredential,
  onUnavailable,
}: {
  clientId: string;
  onCredential: (idToken: string) => void;
  onUnavailable?: (err: unknown) => void;
}) {
  const host = useRef<HTMLDivElement | null>(null);
  const [failed, setFailed] = useState(false);

  // Held in a ref so a re-render with a new closure does not force the button to be torn down and
  // rebuilt — remounting GIS mid-sign-in loses the flow.
  const onCredentialRef = useRef(onCredential);
  onCredentialRef.current = onCredential;
  const onUnavailableRef = useRef(onUnavailable);
  onUnavailableRef.current = onUnavailable;

  useEffect(() => {
    const parent = host.current;
    if (!parent || !clientId) return;
    let cancelled = false;

    const width = Math.round(parent.getBoundingClientRect().width) || 360;
    void renderGoogleButton({
      parent,
      clientId,
      width,
      text: "continue_with",
      onCredential: (idToken) => {
        if (!cancelled) onCredentialRef.current(idToken);
      },
      onError: (err) => {
        if (!cancelled) onUnavailableRef.current?.(err);
      },
    }).catch((err) => {
      if (cancelled) return;
      setFailed(true);
      onUnavailableRef.current?.(err);
    });

    return () => {
      cancelled = true;
    };
  }, [clientId]);

  if (failed) return null;
  return (
    <div
      ref={host}
      // Reserves the button's height so the stack does not jump when GIS finishes loading.
      style={{ minHeight: 44, display: "flex", justifyContent: "center" }}
    />
  );
}
