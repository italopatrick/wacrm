import { describe, expect, it } from "vitest";

import { interpretCreateResponse } from "./companies";

describe("interpretCreateResponse", () => {
  it("maps 201 to ok with the company", () => {
    const r = interpretCreateResponse(201, {
      company: { id: "abc", name: "Acme" },
    });
    expect(r).toEqual({ kind: "ok", company: { id: "abc", name: "Acme" } });
  });

  it("maps 400 to fieldErrors, preserving the fields map", () => {
    const r = interpretCreateResponse(400, {
      error: "validation",
      fields: { ownerEmail: "A valid owner email is required" },
    });
    expect(r).toEqual({
      kind: "fieldErrors",
      fields: { ownerEmail: "A valid owner email is required" },
    });
  });

  it("maps 400 with no fields to an empty fieldErrors map", () => {
    const r = interpretCreateResponse(400, {});
    expect(r).toEqual({ kind: "fieldErrors", fields: {} });
  });

  it("maps 409 to conflict, using the server message when present", () => {
    const r = interpretCreateResponse(409, {
      error: "A user with this email already exists",
    });
    expect(r).toEqual({
      kind: "conflict",
      message: "A user with this email already exists",
    });
  });

  it("maps 403 to a generic error", () => {
    const r = interpretCreateResponse(403, { error: "Forbidden" });
    expect(r).toEqual({ kind: "error", message: "Forbidden" });
  });

  it("maps 500 with no body to a generic error", () => {
    const r = interpretCreateResponse(500, null);
    expect(r.kind).toBe("error");
  });
});
