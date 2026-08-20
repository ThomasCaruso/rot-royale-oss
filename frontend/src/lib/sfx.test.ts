import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as sfx from "@/lib/sfx";

function fakeStorage(): Storage {
  const m = new Map<string, string>();
  return {
    get length() {
      return m.size;
    },
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, String(v)),
    removeItem: (k: string) => void m.delete(k),
    clear: () => m.clear(),
    key: (i: number) => [...m.keys()][i] ?? null,
  } as Storage;
}

describe("sfx — Web Audio, degrades silently", () => {
  beforeEach(() => vi.stubGlobal("localStorage", fakeStorage()));
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("every sound is a no-op (never throws) when AudioContext is unavailable", () => {
    // the `node` test env has no AudioContext — production must not crash when audio is blocked.
    expect(() => {
      sfx.revealTick();
      sfx.scoreImpact();
      sfx.placementImpact();
      sfx.coinChime();
      sfx.ratingRise();
      sfx.podiumFanfare();
      sfx.uiTap();
      sfx.resumeAudio();
    }).not.toThrow();
  });

  it("haptics fail silently when navigator.vibrate is unsupported", () => {
    expect(() => sfx.haptic(20)).not.toThrow();
    expect(() => sfx.haptic([10, 20, 10])).not.toThrow();
  });

  it("mute preference defaults to on and persists across reads", () => {
    expect(sfx.isSfxEnabled()).toBe(true); // sound on by default
    sfx.setSfxEnabled(false);
    expect(sfx.isSfxEnabled()).toBe(false);
    expect(localStorage.getItem("rot_royale_sfx_enabled")).toBe("0");
    sfx.setSfxEnabled(true);
    expect(sfx.isSfxEnabled()).toBe(true);
    expect(localStorage.getItem("rot_royale_sfx_enabled")).toBe("1");
  });

  it("when muted, sounds still no-op without throwing", () => {
    sfx.setSfxEnabled(false);
    expect(() => sfx.podiumFanfare()).not.toThrow();
  });

  it("mute reads fail safe (defaults to enabled) when localStorage is unavailable", () => {
    vi.stubGlobal("localStorage", undefined);
    expect(sfx.isSfxEnabled()).toBe(true);
    expect(() => sfx.setSfxEnabled(false)).not.toThrow();
  });
});
