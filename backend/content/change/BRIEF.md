# Change Detection — image brief

Hand this whole document to the image model. It is the complete spec: what the game is, what makes a
good pair, the hard technical constraints, and how a delivered pair is checked.

> **This document was rewritten on 2026-08-27 after drifting badly from the shipped game.** The
> previous version specified 20 landscape 3:2 pairs, a 250ms/80ms flicker and a 15-second round —
> none of which is what ships. It also promised that ingest automatically rejects a bad pair, which
> it has never done. Every number below was read out of the code or measured in the running app; the
> citations are there so the next person can re-check rather than trust.

---

## 1. What you are making

Rot Royale is a 90-second daily game for 18–30 year olds who are quietly worried their attention
span is cooked. One of its rounds is **change detection**: the player is shown a scene, then the
same scene again with **exactly one thing different**, and taps where the change is.

The cycle is **titled beat → first image → titled beat → second image**, looping:

| Phase | Duration | Source |
|---|---|---|
| "First image" beat | 1.3s | `CHANGE_FLICKER_LABEL_MS` |
| Base image | 5.0s | `CHANGE_FLICKER_BASE_MS` |
| "Second image" beat | 1.3s | `CHANGE_FLICKER_LABEL_MS` |
| Altered image | 7.0s | `CHANGE_FLICKER_ALTERED_MS` |

One full cycle is **14.6s**, and the round limit is **30s** (`CHANGE_TIME_LIMIT_MS`) — so the player
gets **two complete looks** and about 0.8s to spare. All five constants live in
`backend/app/modules/change_detection.py`, where the budget is documented as load-bearing.

**This is a memory comparison, not a flicker test.** An earlier design used the classic 250ms/80ms
flicker, where the blank wipes out the motion signal so the change cannot pop out. At five and seven
seconds the player instead *studies* one image, then the other, and has to hold the first in their
head. That is far more forgiving, and it is the right call for someone playing on a phone for ninety
seconds — but it changes what makes a pair good. **A change that is only findable by A/B flicker
comparison is a bad change here.** It has to be findable by looking.

### The bar this has to clear

The round must feel like a **game**, never like a test. Specifically:

- **Not an IQ test.** No abstract shapes, grids, symbols, arrows, dot patterns, or anything that
  looks like a cognitive assessment. If it could appear in a clinical study, it is wrong.
- **Not a children's spot-the-difference.** No cartoon scenes with a cheerful border, no "find 5
  differences", no visual puns.
- **The change should earn a reaction.** The best ones make the player go *"oh COME ON"* when they
  finally see it — funny, characterful, or slightly absurd. A grey rectangle moving 30px is
  technically valid and completely dead.
- **The scene should be somewhere the player recognises from their own life.** A 2am bedroom lit by
  a phone. A friend's coffee table after a takeaway. A night bus. Not stock-photo boardrooms, not
  fantasy landscapes, not still-life fruit bowls.

If a scene is boring, the round is boring — the mechanic cannot rescue it.

---

## 2. Art direction

All pairs must look like one set, from one world.

- **Style**: cohesive stylized realism — rich, slightly heightened, cinematic. Think premium mobile
  game key art rather than photography or flat vector. Consistency across the set matters more than
  any individual image being spectacular.
- **Lighting**: warm and directional. Strong light sources in frame are welcome (a phone screen, a
  neon sign, a sunset, string lights) — they give the scene depth and make it feel like a place.
- **Palette**: warm and rich. The app around it is ivory, royal purple and gold, so images that
  lean warm-neutral with saturated accent light sit naturally in it.
- **Composition**: readable at a glance. Enough detail that finding the change takes effort, not so
  much visual noise that it becomes a needle-in-a-haystack slog. A scene with 4–8 distinct objects
  plus background is about right.

### Hard prohibitions

- **No text anywhere.** No signage, labels, book titles, screens with words, number plates. Text
  renders badly, and the app runs in four languages. Abstract shapes on signs are fine.
- **No real brands or logos**, and nothing recognisably trademarked.
- **No real or recognisable people**, no celebrity likenesses.
- **No gambling, casino, betting or cash imagery** in NEW content — no chips, chip racks, card
  tables, slot machines, roulette, banknote stacks. Rot Royale has no real money and does not borrow
  casino framing (CLAUDE.md Invariant 6, DESIGN.md §7). Nothing downstream enforces this; it is on
  the person reviewing the delivered images.
  > **`poker_table` is a deliberate, approved exception** — a card table with chips and glasses,
  > reviewed and kept in the set on 2026-08-27 after being flagged against this rule. It is live on
  > purpose. **Do not retire it again**; this note exists because it was already pulled once and
  > restored. The rule still governs anything new.
- **Nothing that dates fast.** No current memes, no this-season's-phone, no topical references. The
  images ship once and stay for years.

---

## 3. The single most important technical rule

**The two images in a pair must be identical except for the one change.**

Do **not** generate the base and the altered image as two separate prompts. Two independent
generations differ in thousands of places — every shadow, every texture, every edge — and the round
becomes unplayable, because *everything* is a change.

The correct workflow is:

1. Generate the **base** image.
2. **Edit that exact image** (inpaint / local edit) to produce the altered version, touching only
   the one region you intend to change.
3. Everything outside the edited region must come through unchanged.

If your editing tool re-renders the whole frame, the pair is unusable. Verify before delivering: the
two images should look like the same file twice, with one difference.

---

## 4. Technical specification

| Property | Value |
|---|---|
| Deliver at | **1122 × 1402** (4:5 portrait) |
| Format | **PNG for delivery** — lossless, see below |
| Naming | `<key>_base.png` and `<key>_altered.png` |
| Colour | sRGB |

**Portrait, not landscape.** The round is played on a phone held upright and the image is the only
thing on screen worth looking at; a landscape frame wastes most of it. The stage is sized from the
image's own aspect ratio (`ChangeRound.tsx`, `aspectRatio: spec.width / spec.height`), so a 4:5
image is never cropped — but an image delivered at a *different* ratio will simply render at that
ratio, in a narrower or shorter box. Keep to 4:5.

**Deliver PNG; the app will not ship PNG.** PNG is required for *delivery* because a lossy source
scatters false differences across the frame and corrupts the diff used to check the pair. But
detailed PNGs are 4–8 MB each and two load per round on mobile data — images, not JavaScript, are
this app's performance bottleneck. The pipeline is: **lossless masters in, optimised JPEG
derivatives out.** That conversion happens on our side. (JPEG, not WebP — WebP breaks on iOS 13,
which the app still supports.)

**Why 1122 wide**: the image renders **342 × 427 CSS px** on a 390px-wide phone (measured in the
running app). Assets ship at 3× their render size, so ~1026 is the useful floor and 1122 is a small
margin over it. Anything substantially larger is just weight.

### The size constraint that actually matters

Judge every change at **342 px wide**, not at full resolution. A detail that is obvious at 1122px
can be literally invisible on the device. Shrink the image to a third of a phone screen and check
that the change is still *findable* — hard is fine, invisible is broken.

**Practical floor: the changed region should be at least ~14 px on screen**, which is **4% of the
image's SHORT edge** (~45px at 1122). Note the short edge: the frame is portrait now, so "4% of the
width" and "4% of the height" are different numbers and the width is the smaller one. Anything below
that must be high-contrast to survive.

### Placement

Keep the changed region inside the **middle 90%** of the frame — nothing in the outer 5% on any
edge. Taps near the border are awkward, and the hit area already extends 5% beyond the change on
each axis (`CHANGE_TAP_TOLERANCE_FRAC = 0.05`).

> Two shipped pairs (`evidence_desk`, `coffee_counter`) violate this, sitting 0.2–0.3% from the
> edge. They were accepted deliberately. Do not read them as permission — they are the reason this
> paragraph now says which two, rather than implying the rule has always held.

### Bounding boxes — do not provide these

You do **not** need to give coordinates for the change. Just tell us **in one sentence what changed**
per pair. The box is placed on our side and checked against that sentence.

---

## 5. What makes a change easy, medium or hard

Difficulty is not about how *small* the change is. It is mostly about how much **attention** the
changed object naturally attracts:

- Changes to the thing the scene is *about* (the subject, the face, the centre) are found fast.
- Changes to background or incidental objects are much harder, even when large — people simply do
  not look there.
- Changes inside a **repeating pattern** (a rack of identical dumbbells, a shelf of boxes) are the
  hardest of all, because there is no unique landmark to compare against.

Use those levers rather than just shrinking things.

| Tier | Region size (short edge) | Where | Feels like |
|---|---|---|---|
| **Easy** | 15–30% | Central, uncluttered, on the subject | Found on the first look. A confident start. |
| **Medium** | 8–15% | Off-centre, or a state/colour change rather than an object appearing | Found on the second look. |
| **Hard** | 4–8% | Background, peripheral, or inside a repeating pattern | Takes both looks and most of the 30s. Must be *unmistakable* once seen. |

Aim for a spread across the set rather than a fixed count per tier — the draw picks an easy-ish
opener and a harder finisher, so both ends need stock.

**Fairness rule for every tier**: once the player sees it, it must be beyond argument. A change that
is ambiguous ("was that shadow always like that?") is a broken item, however hard it is. No
"is-that-slightly-darker" changes.

**One change only.** Not two, not one-plus-a-shadow. If moving an object would realistically change
its shadow or reflection, either accept that as part of the same single change region or pick a
different change.

---

## 6. What to deliver

1. **PNG pairs** at 1122 × 1402, named `<key>_base.png` / `<key>_altered.png`.
2. **A one-line description per pair** of what changed.

No JSON, no coordinates, no manifest, no difficulty labels — all of that is recorded on this side.
Difficulty lives in `content/change/difficulty.json` and is stamped onto each item at ingest.

**Work one pair at a time and check it before moving on.** A long unbroken session drifts: the art
direction wanders, and the edit-in-place discipline in §3 is the first thing to slip. Confirming
each pair as you go is far cheaper than discovering at the end that half the set re-rendered.

---

## 7. How it actually gets checked

**The automated checks are real, but they live in ONE tool that is easy to bypass — and the current
corpus bypassed it.** Know which stage does what before relying on any of it.

**`backend/scripts/build_change_manifest.py` is the gate.** It diffs the pair and rejects it for:

- base and altered differing in dimensions,
- a changed region under `MIN_REGION_FRAC` (4%) of the frame,
- a region touching the outer `EDGE_MARGIN` (5%) on any side,
- a difference too large or too scattered to be one edit — which is how two independently generated
  images are caught, the single most common defect.

It also derives the bbox from the diff, so a pair that passes has a box measured from the pixels.

**Ingest enforces none of that.** `content/change_manifest.py::_item_errors` checks only that the
manifest is well formed — key length, asset ids resolve, positive dimensions, a valid difficulty,
and a bbox of four in-range numbers. It never opens the images. So a manifest assembled by any route
other than the builder gets no image-level checking at all.

> **That is not hypothetical: the shipped corpus took the other route.** Its bounding boxes were
> placed by hand in a drag-to-select tool rather than derived by the builder, which is exactly why
> two pairs (`evidence_desk`, `coffee_counter`) sit 0.2–0.3% from the frame edge — a violation the
> builder would have rejected outright and ingest cannot see. Hand-placing a box is a legitimate
> thing to do when the diff is noisy, but it opts the pair out of every check in this section.

`--retire-missing` (added 2026-08-27) can pull an item back out of the game, which is what makes a
mistake here recoverable rather than permanent.

**So, when adding items:** run them through `build_change_manifest.py` and only override it
deliberately. If you do place a box by hand, do these four yourself, because nothing else will:

1. Diff the pair and confirm the difference is one connected region.
2. Look at both images at 342px wide and confirm the change is findable.
3. Confirm the region clears 4% of the short edge and sits inside the middle 90%.
4. Confirm the scene breaks none of the §2 prohibitions — especially the gambling one, which has
   been missed before.
