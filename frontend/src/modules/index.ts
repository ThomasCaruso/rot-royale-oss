// Activates the client-side round-module registry: importing this registers every module type so
// the contest screen can look modules up by type (mirrors the server registry; docs/architecture.md).
import { ChangeReveal } from "@/modules/changeDetection/ChangeReveal";
import { ChangeRound } from "@/modules/changeDetection/ChangeRound";
import { EstimateReveal } from "@/modules/estimate/EstimateReveal";
import { EstimateRound } from "@/modules/estimate/EstimateRound";
import { MemoryFlashReveal } from "@/modules/memoryFlash/MemoryFlashReveal";
import { MemoryFlashRound } from "@/modules/memoryFlash/MemoryFlashRound";
import { MultipleChoiceRound } from "@/modules/multipleChoice/MultipleChoiceRound";
import { registerModule } from "@/modules/registry";
import { VideoRound } from "@/modules/video/VideoRound";
import type { RoundModule } from "@/modules/types";

const mc = (type: string): RoundModule => ({
  type,
  Component: MultipleChoiceRound as RoundModule["Component"],
  surface: "dom",
});

registerModule(mc("trivia"));
registerModule(mc("rapid_math"));
registerModule({
  // The reveal replays the pattern with the player's taps overlaid. Without it this round ended on
  // the generic "counted / no points" line and never showed WHICH step went — the payoff, thrown
  // away at the moment it was earned (§7a1).
  type: "memory_flash",
  Component: MemoryFlashRound as RoundModule["Component"],
  Reveal: MemoryFlashReveal as RoundModule["Reveal"],
  surface: "dom",
});
// Interactive Daily Royale round types — play a server-bound cognition instance (see the modules).
registerModule({
  type: "estimate",
  Component: EstimateRound as RoundModule["Component"],
  // The generic reveal can only render a trivia option list, so these two carry their own — the
  // answer is the payoff and neither round type could show it otherwise.
  Reveal: EstimateReveal as RoundModule["Reveal"],
  surface: "dom",
});
registerModule({
  // ONE Royale slot, THREE scored answers — the only type that asks more than one question. No
  // Reveal: the round's payoff is the change question itself, which the player has just answered.
  type: "video",
  Component: VideoRound as RoundModule["Component"],
  surface: "dom",
});
registerModule({
  type: "change_detection",
  Component: ChangeRound as RoundModule["Component"],
  Reveal: ChangeReveal as RoundModule["Reveal"],
  surface: "dom",
});
