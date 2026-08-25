import { useEffect, useRef, useState } from "react";
import { renderGoogleButton } from "@/lib/googleIdentity";
import { AUTH_BUTTON_HEIGHT } from "@/ui/SocialButton";

/**
 * "Continue with Google" — Google's own rendered button.
 *
 * ⚠️ CURRENTLY RENDERED NOWHERE. Its only caller was the provider-choice screen, deleted when the
 * front door's returning-player row became the choice (CLAUDE.md §8a). It is kept, rather than
 * deleted with it, for one concrete reason: the row's Google tile hides GIS's button under our own
 * mark, which works but is contrary to Google's branding guidance, and the open follow-up is to see
 * whether an officially rendered button can be made to fit the tile. THIS is the reference for how
 * to render one properly — the measure-then-scale dance below is the non-obvious part. If that
 * follow-up is closed as won't-do, delete this file and the unused half of `SocialButton` with it.
 *
 * Deliberately not our `SocialButton`. A custom button can only produce an ID token via One Tap
 * (`prompt()`), which Google suppresses after a couple of dismissals, in incognito, and for anyone
 * who opted out — so it would silently do nothing for a real share of players. `renderButton` is
 * the supported path for a click, and it is brand-compliant by construction.
 *
 * The cost is that GIS owns the pixels: it exposes width, shape and theme, and NOT height. Its
 * `size: "large"` is 40px, while the sign-in stack is `AUTH_BUTTON_HEIGHT` — so the rendered button
 * is SCALED to fill the row rather than floating at 40px between two taller buttons. Scaling is
 * uniform: the colourway, the mark and their proportions are Google's, untouched, which is what the
 * branding requirements are about. The trade is that Google's label and mark land ~30% larger than
 * ours; `AUTH_BUTTON_FONT` is set to close most of that gap from the other side.
 *
 * The 40px is MEASURED after the render rather than assumed, so the row stays the right height if
 * Google ever changes it — see `natural` below.
 *
 * If it cannot load — blocked script, offline, ad blocker — the component renders NOTHING and tells
 * the parent. The email route is one tap away in the same row (which drops to Email alone when no
 * provider is usable), and a broken button is worse than no button.
 */

/** GIS `size: "large"`. A starting guess only — replaced by the measured height on first render. */
const NATURAL_HEIGHT = 40;

export function GoogleSignInButton({
  clientId,
  onCredential,
  onUnavailable,
}: {
  clientId: string;
  onCredential: (idToken: string) => void;
  onUnavailable?: (err: unknown) => void;
}) {
  const frame = useRef<HTMLDivElement | null>(null);
  const host = useRef<HTMLDivElement | null>(null);
  const [failed, setFailed] = useState(false);
  const [natural, setNatural] = useState(NATURAL_HEIGHT);

  // Held in a ref so a re-render with a new closure does not force the button to be torn down and
  // rebuilt — remounting GIS mid-sign-in loses the flow.
  const onCredentialRef = useRef(onCredential);
  onCredentialRef.current = onCredential;
  const onUnavailableRef = useRef(onUnavailable);
  onUnavailableRef.current = onUnavailable;

  const scale = AUTH_BUTTON_HEIGHT / natural;

  // The row's width, WATCHED rather than read once. GIS takes a pixel width and never re-flows, so
  // a button measured at one viewport keeps that pixel width through a rotation or a resized desktop
  // window and ends up wider or narrower than the buttons above and below it. Observing the row is
  // what keeps "the three are the same width" true after the first paint.
  const [rowWidth, setRowWidth] = useState(0);
  useEffect(() => {
    const outer = frame.current;
    if (!outer) return;
    const read = () => setRowWidth(Math.round(outer.getBoundingClientRect().width));
    read();
    if (typeof ResizeObserver !== "function") return;
    const ro = new ResizeObserver(read);
    ro.observe(outer);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const parent = host.current;
    if (!parent || !clientId) return;
    let cancelled = false;

    // GIS clamps to 400px. The button is rendered at the width it needs to become the row's full
    // width AFTER the scale, then scaled — measure-and-divide rather than a guess, so the Google
    // row is exactly as wide as the Apple and email buttons above and below it.
    const width = Math.min(400, Math.max(200, Math.round((rowWidth || 360) / scale)));
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
    })
      .then(() => {
        // One frame later: GIS injects its stylesheet alongside the markup, so the button has no
        // height in the same tick it appears. A zero here (jsdom, or a render that produced
        // nothing) simply leaves the assumed 40 in place rather than dividing by it.
        if (cancelled || typeof requestAnimationFrame !== "function") return;
        requestAnimationFrame(() => {
          if (cancelled) return;
          // `offsetHeight`, NOT getBoundingClientRect — the rect is the TRANSFORMED box, so
          // measuring it feeds the scale back into itself: 40 renders as 52, 52 is read as the
          // natural height, the scale collapses to 1, and the button settles at 40px in a 52px
          // row. offsetHeight is the layout height and ignores the transform entirely.
          const measured = (parent.firstElementChild as HTMLElement | null)?.offsetHeight ?? 0;
          if (measured > 0 && Math.abs(measured - natural) > 0.5) setNatural(measured);
        });
      })
      .catch((err) => {
        if (cancelled) return;
        setFailed(true);
        onUnavailableRef.current?.(err);
      });

    return () => {
      cancelled = true;
    };
  }, [clientId, scale, natural, rowWidth]);

  if (failed) return null;
  return (
    <div
      ref={frame}
      // The row. Fixed at the stack's height so nothing jumps when GIS finishes loading, and
      // `overflow: hidden` keeps a mis-measured scale from bleeding over the buttons either side.
      style={{
        height: AUTH_BUTTON_HEIGHT,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
      }}
    >
      <div ref={host} style={{ transform: `scale(${scale})`, transformOrigin: "center" }} />
    </div>
  );
}
