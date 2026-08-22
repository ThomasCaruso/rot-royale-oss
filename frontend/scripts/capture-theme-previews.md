# Re-capturing the Vault theme previews

`public/assets/themes/previews/<theme-id>.jpg` are real screenshots of the app's home screen, one
per theme, shown inside the phone frame in the Vault (`screens/vault/ThemeShot.tsx`).

**They go stale the moment the home screen changes shape.** Re-capture whenever it does.

## Why device emulation, not the Chrome extension

Two earlier attempts through the Chrome extension produced wrong assets, both times silently:

1. **Swapping CSS variables is not switching themes.** `useThemeArt()` / `useArtStyle()` read the
   *equipped theme*, so re-painting `--brand` and friends left every shot rendering Starter's art set
   and Starter's card branch in a different palette. Minimal Light, Minimal Dark and Rot Champion —
   which have no `art` and take entirely different branches — were badly misrepresented.
2. **A desktop viewport is not a phone.** The app column is 430px there against a device's 390px, and
   the `clamp(…vw…)` values saturate at their maxima, so text wraps differently from a real phone.

Playwright with a true 390x844 viewport fixes both, and unlike the extension the viewport actually
sticks (the extension's `resize_window` applied minutes late and drifted mid-run, and its renderer
timed out on most captures).

## Steps

1. Backend and frontend both running locally (see the README for the commands).
2. Playwright: `browser_navigate` to `http://localhost:5173/`, then `browser_resize` to **390 x 844**.
3. Register a throwaway account from the page and seed the session — this avoids moving a real
   token between browsers, and the fresh account keeps personal data out of the shots:

   ```js
   const r = await fetch('http://localhost:8001/auth/register', {
     method: 'POST', headers: { 'Content-Type': 'application/json' },
     body: JSON.stringify({
       email: `shot-${Date.now()}@example.com`,   // NOT .local — reserved TLDs are rejected
       username: `Shot${Date.now() % 1e6}`,
       password: 'preview-only-pw-9137',
     }),
   });
   const j = await r.json();
   // Capacitor Preferences is localStorage-backed on web and namespaces keys with `CapacitorStorage.`
   localStorage.setItem('CapacitorStorage.rr.refresh_token', j.refresh_token);
   ```

4. Reload. Dismiss any unlock celebration (a new account may trip the `founder:200` reveal) by
   clicking through `Collect` / `Continue` before capturing.
5. Expose the theme switch, then for each id in `THEMES`: set it, wait ~700ms, screenshot the
   viewport (NOT `fullPage` — the page fits inside 844, and the viewport shot *is* the phone screen).

   ```js
   const { useSessionStore } = await import('/src/store/session.ts');
   window.__setTheme = (id) => {
     const me = useSessionStore.getState().me;
     useSessionStore.setState({ me: { ...me, equipped_theme: id } });
   };
   ```

   Client-side only — this is the same field the equip *response* patches, so no server call and no
   change to anyone's account.
6. Resize to 260px wide, JPEG q78:

   ```python
   im = Image.open(src).convert("RGB")            # 390x844
   im = im.resize((260, 563), Image.LANCZOS)
   im.save(dst, "JPEG", quality=78, optimize=True, progressive=True)
   ```

7. **Simulate the device safe areas BEFORE capturing** — a browser viewport has none, so the app
   header starts at y=0 (which lands under the dynamic island) and the dock sits flush to the bottom
   edge. Do NOT fix this by cropping afterwards: shifting the image down and trimming the bottom
   clears the island but eats the nav.

   ```js
   const st = document.createElement('style');
   st.textContent = `
     body { padding-top: 47px !important; }               /* island / status area */
     nav, div[style*="position: fixed"][style*="bottom"] {
       margin-bottom: 18px !important;                     /* home-indicator gap */
     }
     html { scrollbar-width: none !important; }            /* the inset makes the page overflow */
     html::-webkit-scrollbar { display: none !important; }
   `;
   document.head.appendChild(st);
   ```

   Also paint `document.documentElement.style.background` with the theme's `--bg` on every switch, so
   the exposed top strip is that theme's colour rather than a white band.

   **Read `--bg` AFTER the switch has painted, not in the same tick.** `setState` does not apply the
   new CSS variables synchronously, so reading the computed `--bg` immediately gives you the
   *previous* theme's background and pins it to `<html>`. Because `body`'s background is a stack of
   semi-transparent gradients, the stale colour then bleeds through every later capture — it showed
   up as a cream Vault under Apex, which reads exactly like a hardcoded-ivory bug in the app and
   is not one. Await two `requestAnimationFrame`s first:

   ```js
   window.__setTheme = async (id) => {
     useSessionStore.setState({ me: { ...useSessionStore.getState().me, equipped_theme: id } });
     await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
     document.documentElement.style.background = getComputedStyle(document.body).backgroundImage;
   };
   ```

8. Bump `V` in `ThemeShot.tsx` — `public/` is not content-hashed, so without it everyone keeps the
   cached old shots (`docs/architecture.md` §13).

## Invariants worth re-checking after a capture run

- Every shot is **390x844** before the resize. Anything else means the viewport drifted.
- The **three unique themes** (`blank_light`, `blank`, `royale`) must look structurally different
  from the Starter skins — no crown plate on the Minimal pair, full arcade artwork on Rot Champion.
  If they look like Starter in a different colour, the theme switch did not take (trap 1 above).
- The phone frame's aspect in `PhoneFrame.tsx` is `390 / 844`; the shots must match it or
  `object-fit: cover` will crop the bottom off.
