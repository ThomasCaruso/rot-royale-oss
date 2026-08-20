import { describe, expect, it } from "vitest";
import { resolvePublicRoute } from "@/app/publicRoutes";

describe("resolvePublicRoute", () => {
  it("maps the public pages", () => {
    expect(resolvePublicRoute("/privacy")).toBe("privacy");
    expect(resolvePublicRoute("/terms")).toBe("terms");
    expect(resolvePublicRoute("/support")).toBe("support");
    expect(resolvePublicRoute("/download")).toBe("download");
  });

  it("tolerates a trailing slash (hosts that normalize one)", () => {
    expect(resolvePublicRoute("/download/")).toBe("download");
    expect(resolvePublicRoute("/privacy/")).toBe("privacy");
  });

  it("resolves the built HTML filename to the same route", () => {
    // /download is served by rewriting to download.html; a direct hit must render the same page.
    expect(resolvePublicRoute("/download.html")).toBe("download");
  });

  it("leaves everything else to the app shell", () => {
    for (const path of ["/", "/index.html", "/downloads", "/download/extra", "/c/abc", "/vault"]) {
      expect(resolvePublicRoute(path)).toBeNull();
    }
  });
});
