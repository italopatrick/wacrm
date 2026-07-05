// @vitest-environment jsdom
//
// Regression pins F-6..F-8 (owner-magic-link-onboarding/03_test_anchors.md)
// for the set-password page the owner magic-link lands on. INV-1: these lock
// existing behavior; no page logic is edited. `t` is mocked to echo keys so
// assertions match the i18n key names.

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));
vi.mock("next/link", () => ({
  default: ({
    href,
    children,
  }: {
    href: string;
    children: React.ReactNode;
  }) => <a href={href}>{children}</a>,
}));

const getSession = vi.fn();
const updateUser = vi.fn();
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ auth: { getSession, updateUser } }),
}));

import ResetPasswordPage from "./page";

beforeEach(() => {
  updateUser.mockResolvedValue({ data: {}, error: null });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ResetPasswordPage", () => {
  it("F-6: no recovery session → invalid-link state linking to /forgot-password", async () => {
    getSession.mockResolvedValue({ data: { session: null } });

    render(<ResetPasswordPage />);

    await screen.findByText("invalidLinkTitle");
    const link = screen.getByRole("link", { name: "backToSignIn" });
    expect(link.getAttribute("href")).toBe("/forgot-password");
    expect(updateUser).not.toHaveBeenCalled();
  });

  it("F-7: valid session + matching passwords → updateUser called, success UI", async () => {
    getSession.mockResolvedValue({ data: { session: { user: { id: "u1" } } } });
    const user = userEvent.setup();

    render(<ResetPasswordPage />);

    // Wait for the form (session check resolved).
    const pw = await screen.findByLabelText("password");
    await user.type(pw, "s3cret1");
    await user.type(screen.getByLabelText("confirmPassword"), "s3cret1");
    await user.click(screen.getByRole("button", { name: "submit" }));

    await waitFor(() =>
      expect(updateUser).toHaveBeenCalledWith({ password: "s3cret1" }),
    );
    expect(updateUser).toHaveBeenCalledTimes(1);
    await screen.findByText("successTitle");
  });

  it("F-8a: too-short password → error, updateUser NOT called", async () => {
    getSession.mockResolvedValue({ data: { session: { user: { id: "u1" } } } });
    const user = userEvent.setup();

    render(<ResetPasswordPage />);

    const pw = await screen.findByLabelText("password");
    await user.type(pw, "123");
    await user.type(screen.getByLabelText("confirmPassword"), "123");
    await user.click(screen.getByRole("button", { name: "submit" }));

    await screen.findByText("errorTooShort");
    expect(updateUser).not.toHaveBeenCalled();
  });

  it("F-8b: mismatched passwords → error, updateUser NOT called", async () => {
    getSession.mockResolvedValue({ data: { session: { user: { id: "u1" } } } });
    const user = userEvent.setup();

    render(<ResetPasswordPage />);

    const pw = await screen.findByLabelText("password");
    await user.type(pw, "s3cret1");
    await user.type(screen.getByLabelText("confirmPassword"), "s3cret2");
    await user.click(screen.getByRole("button", { name: "submit" }));

    await screen.findByText("errorMismatch");
    expect(updateUser).not.toHaveBeenCalled();
  });
});
