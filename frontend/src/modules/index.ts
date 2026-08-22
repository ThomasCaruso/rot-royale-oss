// Activates the client-side round-module registry: importing this registers every module type so
// the contest screen can look modules up by type (mirrors the server registry; docs/architecture.md).
import { ChangeReveal } from "@/modules/changeDetection/ChangeReveal";
import { ChangeRound } from "@/modules/changeDetection/ChangeRound";
import { EstimateReveal } from "@/modules/estimate/EstimateReveal";
import { EstimateRound } from "@/modules/estimate/EstimateRound";
import { MemoryFlashRound } from "@/modules/memoryFlash/MemoryFlashRound";
import { MultipleChoiceRound } from "@/modules/multipleChoice/MultipleChoiceRound";
import { registerModule } from "@/modules/registry";
import type { RoundModule } from "@/modules/types";

const mc = (type: string): RoundModule => ({
  type,
  Component: MultipleChoiceRound as RoundModule["Component"],
  surface: "dom",
});

registerModule(mc("trivia"));
registerModule(mc("rapid_math"));
registerModule({
  type: "memory_flash",
  Component: MemoryFlashRound as RoundModule["Component"],
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
  type: "change_detection",
  Component: ChangeRound as RoundModule["Component"],
  Reveal: ChangeReveal as RoundModule["Reveal"],
  surface: "dom",
});
