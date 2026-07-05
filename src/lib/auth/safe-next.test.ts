import { describe, expect, it } from "vitest";

import { safeNext } from "./safe-next";

// Anchors F-1..F-4 (owner-magic-link-onboarding/03_test_anchors.md):
// safeNext is the open-redirect guard the invite flow depends on.
describe("safeNext", () => {
  it("F-1: keeps a same-origin relative path", () => {
    expect(safeNext("/reset-password")).toBe("/reset-password");
  });

  it("F-2: rejects an absolute URL (open redirect blocked)", () => {
    expect(safeNext("https://evil.tld")).toBe("/dashboard");
  });

  it("F-3: rejects a protocol-relative URL", () => {
    expect(safeNext("//evil.tld")).toBe("/dashboard");
  });

  it("F-4: falls back to /dashboard for null", () => {
    expect(safeNext(null)).toBe("/dashboard");
  });

  it("rejects a non-slash relative value", () => {
    expect(safeNext("reset-password")).toBe("/dashboard");
  });
});
