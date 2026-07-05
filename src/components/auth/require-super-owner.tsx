"use client";

import type { ReactNode } from "react";

import { useSuperOwner } from "@/hooks/use-super-owner";

interface RequireSuperOwnerProps {
  /** Rendered while loading OR when the caller is not a super_owner.
   *  Defaults to `null` — most call sites just want the gated element
   *  absent until confirmed. */
  fallback?: ReactNode;
  children: ReactNode;
}

/**
 * `<RequireSuperOwner>…</RequireSuperOwner>` — conditional render for UI
 * gated by the platform super_owner role. Mirrors `RequireRole`, and like
 * it, fails closed while the role is unknown. Must be used inside a
 * `<SuperOwnerProvider>`.
 */
export function RequireSuperOwner({
  fallback = null,
  children,
}: RequireSuperOwnerProps) {
  const { isSuperOwner, loading } = useSuperOwner();
  if (loading) return <>{fallback}</>;
  return isSuperOwner ? <>{children}</> : <>{fallback}</>;
}
