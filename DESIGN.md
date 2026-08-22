# Rot Royale — Visual Design Spec

> **Purpose.** This is the look-and-feel brief for the app's UI — the visual counterpart to
> `docs/architecture.md`. Every screen must feel like a **live game show / arcade trivia game** — energetic,
> glossy, celebratory — **never** a dull SaaS form. Source of truth for the identity is the
> Rot Royale promo art: deep purple-black, royal violet, gold, with green=correct and red=live.
> When in doubt, push it more game, more glow, more motion — not flatter.

---

## 1. Identity in one breath
Dark, premium, electric. Royal **violet** is the hero color; **gold** is reward/CTA; **green** is
correct; **red** is live/urgent. Heavy 3D display type, glassy dark cards, big rounded answer
pills, a circular gold countdown ring, confetti on wins, subtle particle/starfield background,
crown + trophy iconography. It should look like something you'd screenshot and post.

---

## 2. Color tokens (exact)

This **evolves the existing token system**. Note two changes from the current Vault default:
the primary **CTA is now GOLD** (not the green slot), and we add a first-class **`--brand`**
violet. `--cyan` becomes a bright violet accent (still non-blue). Correct stays green; live/wrong
is red.

```
/* base */
--bg        : radial-gradient(1000px 600px at 80% -10%, rgba(124,58,237,.38), transparent 60%),
              radial-gradient(900px 700px at -10% 110%, rgba(147,51,234,.30), transparent 58%),
              #100A22;
--panel     : #1B1136;     /* glassy dark card (apply ~85% + backdrop-blur for glass) */
--panel2    : #241845;     /* raised card / gradient top */
--line      : #38275F;     /* hairline border, low-contrast */

/* brand + accents */
--brand     : #7C3AED;     /* HERO violet: rings, letter badges, option default, glows, FAB */
--brand-2   : #A855F7;     /* bright violet: highlights, question keyword, progress accents */
--cyan      : #A855F7;     /* (repurposed) score / secondary info = bright violet, NOT blue */
--lime      : #2FD45E;     /* CORRECT / success / coins-gained tick */
--amber     : #FFC91E;     /* GOLD: primary CTA, coins, trophy, timer ring, reward */
--pink      : #FF2E4D;     /* LIVE dot / urgency / WRONG */

/* text */
--text      : #FFFFFF;
--muted     : #B3A4D6;     /* lavender-grey */
--faint     : #7E6FA6;
--btnText   : #1B1136;     /* dark text on the gold CTA (gold is light → needs dark text) */
```

**Role rules (do not blur these):**
- **Gold** = the thing you want tapped or won (primary CTA, coins, trophy, timer). Use it like
  treasure — high impact, not wallpaper.
- **Violet** = brand surface & structure (badges, rings, default option chips, glows, the hub).
- **Green** = correct answer only. **Red** = live indicator + wrong answer only.
- Everything readable on dark: white text, lavender-grey for secondary.

---

## 3. Typography

**Display / headings (the "ROT ROYALE" energy):** a heavy, chunky display face. Use
**"Luckiest Guy"** or **"Bungee"** (Google Fonts) for big headings/score numbers, OR a heavy
geometric like **"Sora" 800 / "Archivo Black"** if you want less cartoon, more sport. Give every
large heading the **3D pop treatment**:
```css
.display-3d {
  color:#fff;
  -webkit-text-stroke: 2px rgba(27,17,54,.9);
  text-shadow: 0 2px 0 #4C1D95, 0 4px 0 #3B1782, 0 7px 10px rgba(0,0,0,.45);
  letter-spacing:.5px;
}
.display-3d.gold { color:#FFD24A; text-shadow:0 2px 0 #B97900,0 4px 0 #8A5A00,0 7px 10px rgba(0,0,0,.5); }
```
**The wordmark logo itself** (the crowned "ROT ROYALE") should be shipped as an **image asset**
(PNG/SVG), not rebuilt in CSS — export it from the promo or a clean vector. Headings inside the app
approximate the feel with the font + 3D treatment above.

**Body / UI:** clean bold sans — **"Sora"** or **"Nunito"** 600–800. High contrast, generous size
(mobile-first). Numbers (score, coins, timer) in the display face for punch.

---

## 4. Core components (spec each precisely)

### Glassy card
Dark violet glass: `background: linear-gradient(180deg, var(--panel2), var(--panel))` at ~90%
opacity, `backdrop-filter: blur(12px)`, `border:1px solid var(--line)`, `border-radius:22px`,
soft outer shadow + a faint inner top highlight (`box-shadow: inset 0 1px 0 rgba(255,255,255,.06)`).

### Answer pill (the hero interaction)
- **Default:** full-width rounded pill (`border-radius:16px`, min-height 60px), background
  `var(--panel2)`, 1.5px `var(--line)` border, white bold label, left **letter badge** = a rounded
  square (A/B/C/D) filled `var(--brand)` with white bold letter.
- **Hover/press:** lift 2px, border → `var(--brand-2)`, soft violet glow
  `0 6px 22px rgba(124,58,237,.4)`, slight scale on press.
- **Correct reveal:** fill `var(--lime)`, white text, green glow, **pop** animation (scale 1→1.04→1),
  badge turns white-on-green. (Matches the green "A Mars" in the promo.)
- **Wrong:** fill/border `var(--pink)`, **shake** animation; non-chosen options dim to 40%.

### Circular countdown ring (replaces the linear bar as the primary timer)
SVG ring: track `var(--line)`, progress stroke `var(--amber)` depleting clockwise, big number
centered in the display face. Under ~30% remaining: progress + number turn `var(--pink)` and the
ring **pulses** (scale 1↔1.06). Place top-right of the question card like the promo.

### Question card
Dark, question text large/white with the **keyword highlighted in `var(--brand-2)`** (promo does
this with "Red Planet?"). Small "QUESTION 3/7" label in `--muted` above. Category splash (see §5)
plays before it.

### Primary CTA button (gold)
`background: linear-gradient(180deg,#FFD24A,#FFB300)`, `color:var(--btnText)` (dark),
`border-radius:16px`, chunky padding, display font, **gold glow** `0 10px 30px rgba(255,201,30,.45)`,
press depresses 2px. This is the "Play now" / "Enter contest" button — it should feel like the
promo's "JOIN THE WAITLIST" pill: bright, glowing, unmissable. Secondary buttons = violet outline
ghost on dark.

### Live/window status strip (see honesty note §7)
Red pulsing dot + label for the **open Daily Royale window** ("DAILY ROYALE · open until {local
time}" — the close time shown in the viewer's local timezone; the window is defined as a full 24h
day, midnight-to-midnight ET), and a **neutral field size** ("Field of 8" / "ranked against 8") — the size of the field you're
ranked against — **real entries only**, no synthetic padding (see §7). Say "**8 players**": every
one of them really entered, so naming them as people is the honest wording. (This reverses the older
rule that forced vaguer "Field of 8" phrasing — that rule existed only because the field used to be
padded with bots.) A count must still always come from real data.

### Trophy / coins / streak
Gold trophy icon as the rewards/standings entry point (the promo's FAB). Coins shown as a gold ◆
with the balance in display font. Streak = flame in `--amber`→`--pink` gradient.

---

## 5. Motion & effects — the "not dull" engine
Build these as reusable primitives; use them everywhere:
- **Category splash** before each round: icon + category name zoom-in with a pop + brief shimmer,
  ~1s, then the question.
- **Correct:** pill pop + a short **confetti burst** + score **count-up** animation + a satisfying
  tick. **Wrong:** shake + brief red flash.
- **Streak:** flame grows and the multiplier (×1.2, ×1.4…) flies up as points are added.
- **Results / winner moment:** big confetti, the place number slams in (display 3D), coins
  count-up with gold sparkle, rating delta animates. This is the screenshot moment — make it loud.
- **Buttons:** every tap depresses; gold CTAs have a slow idle glow pulse.
- **Background:** subtle drifting particles / faint starfield over the violet radial vignette;
  optional faint lightning flickers on big moments. Keep it GPU-cheap (transforms/opacity only).
- **Hub:** equipped theme reflected; gentle idle motion so it never feels static.

Respect `prefers-reduced-motion` (drop confetti/parallax, keep state changes). Mobile-first, 60fps.

---

## 6. Theme system integration
Make this the **new default theme**, id `royale`, with a new art **style `"arcade"`** that carries
the glass + glow + 3D-heading + confetti treatment. Keep `soft` / `pixel` / `mono` and the existing
themes available as unlockable modes (Midnight, Bubblegum, etc.). The `--brand`/`--brand-2` tokens
get added to every theme (pick sensible per-theme values). Phaser hub scenes read the same tokens
so the canvas re-skins with the DOM.

---

## 7. HONESTY / COPY RULES — read this before writing any UI strings
The promo is aspirational marketing for a waitlist. **v1 is currency-only and async**, by design
(legal + product). The *visuals* adopt the promo fully; the *words and fake-social elements* must
match reality:

- **Coins, not cash.** Never "cash," "real prizes," "win money," "jackpot," "bet," "wager." It's
  "win **coins**," "climb the ladder," "for bragging rights." (This is the exact gambling-claim
  language we deliberately avoided — keep it out of the product.)
- **Windowed, not broadcast-live.** A window being *open* is real, so "open until 11:00" / a red
  "open now" dot is fine. Do **not** imply a synchronous broadcast everyone watches together.
- **No synthetic field-fill at all.** The Daily Royale field is **real entries only** — the
  cold-start bots that once padded the leaderboard, the per-round field endpoint, and settlement
  have been removed. A thin field is shown honestly as a thin field; an empty one shows "Waiting
  for players…" rather than a fabricated name. The **duel rival** is the single permitted synthetic
  opponent: it is a disclosed, opt-in 1v1 practice partner, never a leaderboard entrant and never
  counted in a field size. Because the count is now real, **copy may say "8 players"** — the word
  "player" is no longer banned. What a count may never be is invented: no "players online / now
  playing" figure, and no number that isn't read from real entries.
  What stays **banned**: fabricated *real-time human* liveness — a fake live chat, a "4,258 watching"
  concurrent-viewer count, "X is answering now," or any invented real-time message/action attributed
  to a person.
  Real-human signals (the real entry count, real recent results) must still come from real data.
  Fabricated *live-human* activity misrepresents an async game as live multiplayer and burns trust.

Marketing surfaces (landing/waitlist, out of app scope) can be more aspirational, but anything a
logged-in player sees must be true.

---

## 8. Acceptance ("looks like the promo, behaves like the product")
- Dark violet world, gold CTAs that glow, green-correct / red-wrong answer pills with letter badges,
  circular gold timer ring, 3D headings, confetti on wins, particle background. Screenshot-worthy.
- Zero "cash/prize/bet" language; neutral field language ("field of N"), real-human signals real,
  synthetic field-fill allowed (deterministic, beatable, phased-out, money-gated, never claimed
  human); no fake live chat / concurrent-viewer numbers / "X answering now".
- 60fps on mobile, `prefers-reduced-motion` honored, all text legible on dark (WCAG AA).
