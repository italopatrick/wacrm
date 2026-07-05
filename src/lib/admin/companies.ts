// ============================================================
// Platform admin — store (company) provisioning client.
//
// Thin wrappers over `apiFetch` for the super_owner `/admin` console.
// Every call goes to the Go backend under `/api/admin/*` (rewritten by
// next.config.ts) and carries the caller's Supabase JWT. Authorization
// is enforced server-side by the backend's AuthSuperOwner middleware —
// these helpers never gate access themselves.
// ============================================================

import { apiFetch } from "@/lib/api/client";

/** One store as returned by GET /api/admin/companies. */
export interface CompanySummary {
  id: string;
  name: string;
  created_at: string;
  member_count: number;
  owner: { user_id: string; full_name: string; email: string | null };
}

/** A store's detail, including its members (GET /api/admin/companies/{id}). */
export interface CompanyMember {
  full_name: string;
  role: string;
  joined_at: string;
}
export interface CompanyDetail {
  id: string;
  name: string;
  created_at: string;
  owner: { user_id: string; full_name: string; email: string | null };
  members: CompanyMember[];
}

/** Payload for POST /api/admin/companies. Keys match the backend verbatim. */
export interface CreateCompanyInput {
  name: string;
  ownerEmail: string;
  ownerFullName: string;
}

/**
 * Discriminated outcome of a create attempt. Pure `interpretCreateResponse`
 * maps the HTTP result to one of these so the form can branch without
 * re-deriving status semantics.
 */
export type CreateCompanyResult =
  | { kind: "ok"; company: { id: string; name: string } }
  | { kind: "fieldErrors"; fields: Record<string, string> }
  | { kind: "conflict"; message: string }
  | { kind: "error"; message: string };

/**
 * Map a create-company HTTP response to a CreateCompanyResult. Pure and
 * unit-tested — no I/O, so it can be exercised without a network stub.
 *
 *   201 → ok            (company created)
 *   400 → fieldErrors   (per-field validation; `fields` may be empty)
 *   409 → conflict      (owner email already exists)
 *   else → error        (403 / 500 / unexpected)
 */
export function interpretCreateResponse(
  status: number,
  payload: unknown,
): CreateCompanyResult {
  const body = (payload ?? {}) as Record<string, unknown>;
  if (status === 201) {
    const company = (body.company ?? {}) as { id?: string; name?: string };
    return { kind: "ok", company: { id: company.id ?? "", name: company.name ?? "" } };
  }
  if (status === 400) {
    const fields =
      body.fields && typeof body.fields === "object"
        ? (body.fields as Record<string, string>)
        : {};
    return { kind: "fieldErrors", fields };
  }
  if (status === 409) {
    return {
      kind: "conflict",
      message:
        typeof body.error === "string"
          ? body.error
          : "A user with this email already exists",
    };
  }
  return {
    kind: "error",
    message:
      typeof body.error === "string" ? body.error : "Could not create the store",
  };
}

/** GET /api/admin/companies — throws on non-OK. */
export async function listCompanies(): Promise<CompanySummary[]> {
  const res = await apiFetch("/api/admin/companies");
  if (!res.ok) throw new Error("Failed to load stores");
  const data = (await res.json()) as { companies: CompanySummary[] };
  return data.companies ?? [];
}

/** GET /api/admin/companies/{id} — throws on non-OK. */
export async function getCompany(id: string): Promise<CompanyDetail> {
  const res = await apiFetch(`/api/admin/companies/${encodeURIComponent(id)}`);
  if (!res.ok) throw new Error("Failed to load store");
  const data = (await res.json()) as { company: CompanyDetail };
  return data.company;
}

/** POST /api/admin/companies — never throws on 4xx; returns a result. */
export async function createCompany(
  input: CreateCompanyInput,
): Promise<CreateCompanyResult> {
  const res = await apiFetch("/api/admin/companies", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const payload = await res.json().catch(() => ({}));
  return interpretCreateResponse(res.status, payload);
}
