import type { RoundModule } from "@/modules/types";

/**
 * Client-side round-module registry, keyed by `type`. Adding a game mode = registering a module
 * here; the contest engine is never touched (docs/architecture.md). Empty in M0; modules register from M2.
 */
const registry = new Map<string, RoundModule>();

export function registerModule(module: RoundModule): void {
  if (registry.has(module.type)) {
    throw new Error(`Round module already registered: ${module.type}`);
  }
  registry.set(module.type, module);
}

export function getModule(type: string): RoundModule {
  const module = registry.get(type);
  if (!module) throw new Error(`Unknown round module: ${type}`);
  return module;
}

/**
 * Non-throwing lookup, for callers where an unknown type is a reason to render LESS rather than to
 * fail. Playing a round genuinely cannot proceed without its module, so `getModule` throws — but a
 * decoration like the post-answer reveal must never be able to take the screen down over a type it
 * doesn't recognise. A render throw unmounts the whole tree (see app/ErrorBoundary.tsx).
 */
export function tryGetModule(type: string): RoundModule | undefined {
  return registry.get(type);
}
