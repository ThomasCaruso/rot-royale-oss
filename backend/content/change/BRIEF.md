# Change Detection — image brief (20 pairs)

Hand this whole document to the image model. It is the complete spec: what the game is, what makes a
good pair, the hard technical constraints, and the 20 scenes to build.

---

## 1. What you are making

Rot Royale is a 90-second daily game for 18–30 year olds who are quietly worried their attention
span is cooked. One of its rounds is **change detection**: the player sees a scene flicker

> base image (250ms) → blank (80ms) → altered image (250ms) → blank (80ms) → repeat

and taps where the change is, within 15 seconds — about 22 flicker cycles. The blank between frames
is the whole trick: it wipes out the motion flash that would otherwise make the change leap out, so
the player has to actually *look*.

You are producing **20 pairs of images**. Each pair is the same scene twice, identical in every
respect except **exactly one thing**.

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

If a scene is boring, the round is boring — the flicker mechanic cannot rescue it.

---

## 2. Art direction

All 20 must look like one set, from one world.

- **Style**: cohesive stylized realism — rich, slightly heightened, cinematic. Think premium mobile
  game key art rather than photography or flat vector. Consistency across all 20 matters more than
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
- **No gambling, casino, betting or cash imagery** of any kind — no chips, slot machines, roulette,
  banknote stacks. This is a hard product rule, not a stylistic preference.
- **Nothing that dates fast.** No current memes, no this-season's-phone, no topical references. The
  images ship once and stay for years.

---

## 3. The single most important technical rule

**The two images in a pair must be pixel-identical except for the one change.**

Do **not** generate the base and the altered image as two separate prompts. Two independent
generations differ in thousands of places — every shadow, every texture, every edge — and the round
becomes unplayable, because *everything* is a change.

The correct workflow is:

1. Generate the **base** image.
2. **Edit that exact image** (inpaint / local edit) to produce the altered version, touching only
   the one region you intend to change.
3. Everything outside the edited region must come through byte-identical.

If your editing tool re-renders the whole frame, the pair is unusable. Verify before delivering: the
two images should look like the same file twice, with one difference.

This is checked automatically on ingest. A pair whose difference is spread across the frame is
rejected, not fixed.

---

## 4. Technical specification

| Property | Value |
|---|---|
| Generate at | **1536 × 1024** (3:2 landscape) |
| Deliver at | **1024 × 683 PNG**, downscaled from the same source |
| Format | **PNG for delivery** — lossless, see below |
| Naming | `<key>_base.png` and `<key>_altered.png`, using the keys in §6 |
| Colour | sRGB |

**Deliver PNG; the app will not ship PNG.** PNG is required for *delivery* because the change
region is located by pixel-diffing the pair, and lossy compression would scatter false differences
across the frame and corrupt that measurement. But 40 detailed PNGs is 40–80 MB, and two of them
load per round on mobile data — images, not JavaScript, are this app's performance bottleneck. So
the pipeline is: **lossless masters in, bounding boxes measured, optimised JPEG derivatives out.**
That conversion happens on our side; you do not need to do it. (JPEG, not WebP — WebP breaks on
iOS 13, which the app still supports.)

**Why 1024 wide**: the image renders about **325 px wide on a phone**. Assets ship at 3× their
render size, so 1024 is the useful ceiling — anything larger is just weight. This also sets the real
difficulty constraint, below.

### The size constraint that actually matters

Judge every change at **325 px wide**, not at full resolution. A detail that is obvious at 1536px
can be literally invisible on the device. Shrink the image to a third of a phone screen and check
that the change is still *findable* — hard is fine, invisible is broken.

Practical floor: the changed region should be **at least 4% of the image width** (~40px at 1024,
~13px on screen). Anything smaller must be high-contrast to survive.

### Placement

Keep the changed region inside the middle 90% of the frame — nothing in the outer 5% on any edge.
Taps near the border are awkward, and the hit area extends 5% beyond the change in every direction.

### Bounding boxes — do not provide these

You do **not** need to give coordinates for the change. They are computed exactly by pixel-diffing
your two images, which is more accurate than any estimate and doubles as the check that the pair is
clean. Just tell us **in one sentence what changed** per pair.

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

| Tier | Region size | Where | Feels like |
|---|---|---|---|
| **Easy** (6 pairs) | 15–30% of width | Central, uncluttered, on the subject | Found in 1–3 flickers. A confident start. |
| **Medium** (8 pairs) | 8–15% | Off-centre, or a state/colour change rather than an object appearing | Takes a few cycles, then obvious. |
| **Hard** (6 pairs) | 4–8% | Background, peripheral, or inside a repeating pattern | Takes most of the 15s. Must be *unmistakable* once seen. |

**Fairness rule for every tier**: once the player sees it, it must be beyond argument. A change that
is ambiguous ("was that shadow always like that?") is a broken item, however hard it is. No
"is-that-slightly-darker" changes.

**One change only.** Not two, not one-plus-a-shadow. If moving an object would realistically change
its shadow or reflection, either accept that as part of the same single change region or pick a
different change.

---

## 6. The 20 scenes

Difficulty is assigned. Keep the assigned key exactly — it is the database identity.

### Easy — 6

| Key | Scene | The change |
|---|---|---|
| `pizza_night` | Friends' coffee table after a takeaway: open pizza box, game controllers, cans, feet up on the sofa edge | **One whole slice of pizza is gone** from the box |
| `bedroom_2am` | Dark bedroom lit only by a phone screen, window showing night sky, duvet chaos | **The moon outside the window disappears** |
| `festival_crowd` | Outdoor gig from behind the crowd, hands up, stage lights raking | **A big inflatable flamingo in the crowd disappears** |
| `dog_park_catch` | Dog mid-leap catching a frisbee, park, owner blurred behind | **The frisbee vanishes** — the dog is still mid-catch |
| `gaming_setup` | Desk at night: ultrawide monitor glow, mechanical keyboard, headset on a stand, energy drink | **The monitor's glow changes from purple to green**, relighting the desk |
| `laundromat_wait` | Row of washing machines, one person sat on a plastic chair on their phone | **A large potted plant appears** beside the machines |

### Medium — 8

| Key | Scene | The change |
|---|---|---|
| `bodega_counter` | Late-night corner shop counter, snack racks, a cat sitting on the counter | **The cat is lying down instead of sitting up** |
| `rooftop_party` | Rooftop at dusk, string lights, city skyline, drinks on a ledge | **One run of the string lights is dark** |
| `train_platform` | Commuters waiting on a platform, one leaning out to look down the track | **A waiting commuter's backpack changes colour** (orange → deep blue) |
| `deadline_desk` | Cluttered study desk: laptop, sticky notes on the wall, cold coffee, headphones | **One sticky note is gone** from the wall cluster |
| `noodle_stall` | Night market food stall, steam, hanging bulbs, bowls lined up | **The steam plume above one bowl disappears** |
| `skate_park` | Skater mid-trick on a ramp, three friends watching from the lip | **One watcher's arms go from crossed to raised overhead** |
| `roadtrip_dash` | Dashboard POV: hands on the wheel, open road, something hanging from the mirror | **The hanging air freshener changes from a pine tree to a dice pair** |
| `cereal_aisle` | Supermarket aisle, trolley in frame, shelves of boxes | **One box is turned sideways** on the shelf |

### Hard — 6

| Key | Scene | The change |
|---|---|---|
| `kitchen_morning_after` | Kitchen the morning after a party: bottles, glasses, a fridge covered in magnets | **One fridge magnet moves** to a different spot |
| `barbershop_chair` | Barber mid-cut, big mirror, shelf of bottles behind | **One bottle on the background shelf changes colour** |
| `plane_window_seat` | Cabin interior from a window seat, clouds outside, seat backs receding | **A window shade several rows ahead is up instead of down** |
| `dorm_poster_wall` | Wall above a bed covered in posters and pinned polaroids | **One polaroid is rotated** about 15° |
| `beach_sunset_friends` | Friends silhouetted against a sunset, sea and horizon behind | **A distant sailboat on the horizon disappears** |
| `gym_rack` | Gym: rack of dumbbells in a neat row, mirror, bench in frame | **One dumbbell is missing** from the middle of the row |

---

## 7. What to deliver

1. **40 PNGs** at 1024 × 683, named `<key>_base.png` / `<key>_altered.png`.
2. **A one-line description per pair** of what changed — used to sanity-check the computed
   bounding box against intent.

No JSON, no coordinates, no manifest, and no difficulty labels — the tiers in §6 are already
recorded on this side (`content/change/difficulty.json`) and stamped onto each item automatically.
Everything in this section that isn't an image is generated from the images.

**Work one pair at a time and check it before moving on.** A long unbroken session drifts: the art
direction wanders, and the edit-in-place discipline in §3 is the first thing to slip. Confirming
each pair as you go is far cheaper than discovering at pair 20 that half the set re-rendered.

## 8. How it gets checked

Every pair is pixel-diffed on ingest. A pair is **rejected** if:

- the difference is spread over more than one connected region (two independent generations, or an
  edit that re-rendered the frame),
- the changed region is under 4% of image width, or sits in the outer 5% of the frame,
- the images differ in dimensions.

Rejected pairs come back for regeneration rather than being patched, so the workflow in §3 is worth
getting right the first time.
