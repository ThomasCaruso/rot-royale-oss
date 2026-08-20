---
name: game-ui-design
description: Use when improving Rot Royale's visual design, interaction design, game feel, layout, progression systems, or any page-level/screen UI. Makes screens feel like a premium quest-based mobile game (rewarding, progression-driven, momentum-creating) rather than a SaaS dashboard. Triggers on requests to redesign/polish a screen, build a campaign/quest map, improve game feel, or make a page "feel like a game." Enforces the honesty/copy rules (coins are cosmetic; no casino/gambling language) and the plan-before-coding workflow.
---

# Skill: Game UI Design — Premium Quest-Based Mobile Experience

## Purpose

Use this skill whenever improving the app's visual design, interaction design, game feel, layout, progression systems, or page-level UI.

The goal is not to make the app "prettier." The goal is to make the app feel like a real game: rewarding, clear, playful, progression-driven, and emotionally satisfying.

The app should feel closer to a premium mobile game than a SaaS dashboard.

## Core Design Standard

Every screen should answer:

1. What is the player doing right now?
2. What progress are they making?
3. What reward or unlock are they moving toward?
4. What is the next obvious action?
5. Does the screen feel fun before the user taps anything?

If a screen only displays information, redesign it so it creates momentum.

## Visual Direction

Use a polished mobile-game style:

* Dark purple / indigo cosmic background
* Neon violet accents
* Bright yellow / gold reward accents
* Rounded cards with glow and depth
* Big playful display typography for headers
* Smaller clean text for details
* Sparkles, soft stars, particles, paths, badges, chests, medals, flags, locks, and coins
* Premium, fun, usable — not cluttered
* Game/sport energy, not casino energy

Avoid:

* Plain rectangles
* Flat SaaS cards
* Too much text
* Dead empty space
* Generic gradients
* Overly serious enterprise layout
* Casino, slot-machine, gambling, jackpot, cash-prize, or betting language

## Product Framing Rules

This app is a trivia game with campaign progression, practice, rank, and cosmetics.

Coins are cosmetic only.

Allowed language:

* Campaign
* Quest
* Level
* Chapter
* World
* Cleared
* Score Banked
* Final results are in
* Ranked against the field
* Top of the field
* Podium finish
* Crown secured
* Coins
* Chest
* Cosmetic
* Unlock
* Streak
* Progress
* Field

Avoid:

* Cash
* Prize
* Bet
* Wager
* Jackpot
* Gambling
* Casino
* "Players" when "field" is more on-brand

## Campaign Mode Design Principles

Campaign mode should feel like a journey through worlds.

The campaign home should feel like a world-selection hub, not a category list.

Each campaign/category should feel like a quest map, not a list of lessons.

Use:

* Category worlds
* Illustrated world cards
* Stars or medals
* Progress bars
* Dotted paths
* Locked and unlocked states
* Reward milestones
* Chests
* Coins
* Chapter labels
* Current mission highlight
* Completed level badges
* Clear next action

Each card should show:

* What it is
* Progress
* Reward potential
* State: selected, available, completed, locked

## Quest / Level Screen Design Principles

Internal campaign screens should feel like a map.

Use:

* Vertical or winding quest paths
* Level nodes or quest cards
* Chapter sections
* Reward milestones on the path
* Locked future levels
* Current level with strong glow / play action
* Completed level with medal, score, or stars
* Clear "locked — clear previous level" messaging
* Thematic illustrations for each level

The user should instantly understand:

* What they completed
* What is next
* What is locked
* What they are working toward

## Game Feel Requirements

When improving UI, consider:

* Micro-rewards: stars, coins, badges, "cleared" states
* Anticipation: chest progress, unlock previews, next milestone
* Momentum: obvious next action, strong play button, highlighted current mission
* Status: progress, rank, streak, cleared count
* Feedback: glow, scale, shine, haptics where appropriate
* Personality: icons, playful copy, category-specific illustrations

Do not overanimate. The app should feel alive, not chaotic.

## Layout Rules

Use mobile-first hierarchy.

Every important page should have:

1. A strong header
2. A status/progress area
3. A clear primary action
4. A progression surface
5. A reward or unlock cue
6. Clean bottom navigation if applicable

Cards should have:

* Strong visual anchor
* Minimal text
* Clear state
* Tap affordance
* Consistent spacing

Use fewer words and stronger visuals.

## State Design

Every screen must handle:

* Empty state
* Locked state
* Available state
* In-progress state
* Completed state
* Error/loading state

Locked should still feel exciting, not dead. Show what is coming.

Completed should feel rewarding, not just disabled.

Available/current should be the most visually obvious next action.

## Accessibility / Performance Rules

Respect:

* `prefers-reduced-motion`
* readable contrast
* tap target sizing
* keyboard/focus states where applicable
* responsive layouts
* performance on mobile

Use CSS effects carefully:

* Gradients
* Glow
* Transform
* Opacity
* Small particles
* Simple keyframes

Avoid expensive layout thrashing or heavy animation loops.

## Implementation Behavior

Before coding, inspect the existing files and current UI structure.

Then output a plan:

1. Current screen diagnosis
2. Design goal
3. Files to modify
4. Component changes
5. CSS/theme changes
6. State/data assumptions
7. Copy changes
8. Test plan
9. Risks

Only code after the plan is approved.

When coding:

* Preserve existing functionality
* Avoid backend changes unless explicitly approved
* Avoid changing data contracts unless necessary
* Keep changes scoped to the requested screen/system
* Prefer reusable components if the pattern will appear elsewhere
* Do not introduce new dependencies unless clearly justified
* Keep tests green

## Visual Quality Bar

The final UI should look like it belongs in a polished mobile game.

Reference quality:

* Campaign home = world-selection hub with illustrated category worlds, coins, chests, progress, and path-like progression
* Category detail = quest map with level cards, chapter labels, current mission glow, locked future levels, rewards, and progression trail

The design should feel:

* Fun
* Premium
* Clear
* Rewarding
* Competitive
* Safe
* Not casino-like
* Not SaaS-like

## Default Design Heuristic

If a screen feels like a menu, turn it into a map.

If a card feels like a row, turn it into a quest.

If progress feels like a number, turn it into a reward path.

If locked content feels dead, turn it into anticipation.

If completed content feels static, turn it into achievement.

If the next action is not obvious, make it glow.

---

## Rot Royale repo context (how this skill maps to the codebase)

Concrete hooks so this skill is actionable here — verify against the live code before relying on any
detail (names drift):

* **Frontend lives in `frontend/`** (Vite + React + TS). Screens in `src/screens/`, reusable motion/UI
  primitives in `src/ui/`, theme tokens in `src/theme/tokens.ts`, global CSS/keyframes in
  `src/theme/global.css` (or `src/global.css`). Campaign screens are under `src/screens/campaign/`.
* **Reuse the existing primitives — do not re-roll effects.** `src/ui/` already has `Confetti`,
  `CountUp`, `CountdownRing`, `AnswerPill`, `GoldButton`, `GlassCard`, `Display`, `CategorySplash`,
  `Starfield`, and `useReducedMotion`. All are `prefers-reduced-motion`-aware. Compose these first.
* **Default theme is `royale`** (style `arcade`): dark violet-black world; **gold** = CTA/coins/timer,
  **green** = correct, **red** = wrong/live, **violet** (`--brand`/`--brand-2`) = brand surface. Skin
  via CSS custom properties (`--bg`, `--panel`, `--brand`, `--amber`, `--lime`, `--pink`, etc.) — never
  hardcode hex when a token exists.
* **The honesty/copy rules above are MANDATORY and already enforced by tests** (DESIGN.md §7). Copy
  guards scan player-facing strings (e.g. `frontend/src/lib/campaign.ts` `CAMPAIGN_COPY`, the campaign
  manifest titles) for banned words. Keep new copy in guarded constants where possible. Field counts
  come from real entries — never fabricate "N players".
* **Plan-before-coding is enforced repo-wide** (`CLAUDE.md`). Output the 9-point plan and wait for
  approval. Avoid backend/data-contract changes unless explicitly approved. Keep `npm run typecheck`,
  `npm run lint`, `npm run build`, and the vitest suite green.
* **`RotRoyale.jsx`** (repo root) is the frontend feel reference and `DESIGN.md` is the visual spec —
  port from them; when in doubt, match their art styles and theme schema rather than inventing.
