import { describe, expect, it } from "vitest";
import { en } from "@/i18n/en";
import { es } from "@/i18n/es";
import { fr } from "@/i18n/fr";
import { tr } from "@/i18n/tr";
import { apiErrorCode, errorMessage } from "@/i18n/errors";
import { ApiError } from "@/api/client";

const FALLBACK = "Algo salió mal";

describe("apiErrorCode — shape is the contract", () => {
  it("recognises a snake_case code", () => {
    expect(apiErrorCode(new ApiError(409, "already_entered"))).toBe("already_entered");
  });

  it("treats English prose as NOT a code", () => {
    // This is what keeps a partially migrated API safe: an endpoint still sending prose resolves to
    // null, so the caller's translated fallback wins instead of the prose being shown.
    expect(apiErrorCode(new ApiError(409, "Window is not open"))).toBeNull();
    expect(apiErrorCode(new ApiError(500, "Server error 500 on GET /x"))).toBeNull();
  });

  it("survives non-Error values without throwing", () => {
    for (const v of [null, undefined, 42, "already_entered", {}, { message: 7 }]) {
      expect(() => apiErrorCode(v)).not.toThrow();
    }
    expect(apiErrorCode(null)).toBeNull();
    expect(apiErrorCode({})).toBeNull();
  });
});

describe("errorMessage — never renders a raw server string", () => {
  it("maps a known code into the active language", () => {
    expect(errorMessage(new ApiError(409, "already_entered"), es, FALLBACK)).toBe(
      es.errors.already_entered,
    );
    expect(errorMessage(new ApiError(409, "already_entered"), fr, FALLBACK)).toBe(
      fr.errors.already_entered,
    );
  });

  it("falls back for an UNKNOWN code rather than inventing text", () => {
    expect(errorMessage(new ApiError(418, "some_future_code"), es, FALLBACK)).toBe(FALLBACK);
  });

  it("NEVER surfaces server prose to the player", () => {
    const prose = "Window is not open";
    const out = errorMessage(new ApiError(409, prose), es, FALLBACK);
    expect(out).toBe(FALLBACK);
    expect(out).not.toContain(prose);
  });

  it("falls back on network failures and non-API throwables", () => {
    expect(errorMessage(new Error("boom"), es, FALLBACK)).toBe(FALLBACK);
    expect(errorMessage(undefined, es, FALLBACK)).toBe(FALLBACK);
  });

  it("resolves every shipped code in every locale to non-empty, non-English-leaking text", () => {
    for (const [name, dict] of [
      ["en", en],
      ["es", es],
      ["fr", fr],
      ["tr", tr],
    ] as const) {
      for (const code of Object.keys(en.errors)) {
        const out = errorMessage(new ApiError(400, code), dict, FALLBACK);
        expect(out, `${name}.${code}`).not.toBe(FALLBACK);
        expect(out.trim().length, `${name}.${code} empty`).toBeGreaterThan(0);
        // The rendered message must never be the raw code itself.
        expect(out, `${name}.${code} leaked the code`).not.toBe(code);
      }
    }
  });
});
