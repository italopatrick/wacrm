// @vitest-environment jsdom
//
// Regression pin F-5 (owner-magic-link-onboarding/03_test_anchors.md):
// /auth/callback with a resolvable session forwards to `next` via
// router.replace exactly once (the `done` guard must dedupe the
// onAuthStateChange + getSession paths). INV-1: no page logic is edited.

import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const replace = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace }),
}));
vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

// Mutable supabase mock, configured per test.
let authCallback: ((event: string, session: unknown) => void) | null = null;
const auth = {
  onAuthStateChange: vi.fn((cb: (e: string, s: unknown) => void) => {
    authCallback = cb;
    return { data: { subscription: { unsubscribe: vi.fn() } } };
  }),
  setSession: vi.fn().mockResolvedValue({ data: {}, error: null }),
  exchangeCodeForSession: vi.fn().mockResolvedValue({ data: {}, error: null }),
  getSession: vi
    .fn()
    .mockResolvedValue({ data: { session: { user: { id: "u1" } } } }),
};
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ auth }),
}));

import AuthCallbackPage from "./page";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  authCallback = null;
});

describe("AuthCallbackPage", () => {
  it("F-5: forwards to next via router.replace exactly once", async () => {
    window.history.replaceState(
      {},
      "",
      "/auth/callback?next=/reset-password#access_token=a&refresh_token=b",
    );

    render(<AuthCallbackPage />);

    await waitFor(() => expect(replace).toHaveBeenCalled());

    // Fire the auth-state-change path too: the `done` guard must keep it single.
    authCallback?.("SIGNED_IN", { user: { id: "u1" } });

    expect(replace).toHaveBeenCalledTimes(1);
    expect(replace).toHaveBeenCalledWith("/reset-password");
  });

  it("F-5b: absent next falls back to /dashboard (safeNext)", async () => {
    window.history.replaceState(
      {},
      "",
      "/auth/callback#access_token=a&refresh_token=b",
    );

    render(<AuthCallbackPage />);

    await waitFor(() => expect(replace).toHaveBeenCalledWith("/dashboard"));
    expect(replace).toHaveBeenCalledTimes(1);
  });
});
