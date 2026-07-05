"use client";

// ============================================================
// useSuperOwner — platform super_owner introspection for the /admin
// console.
//
// Fetches GET /api/admin/me once and shares the result via context (same
// "one fetch for the tree" shape as AuthProvider). This is a UX gate only:
// the Go backend enforces the real authorization on every /api/admin/*
// call. Fails CLOSED — any error resolves to `isSuperOwner: false`.
// ============================================================

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

import { apiFetch } from "@/lib/api/client";

interface SuperOwnerContextValue {
  /** True only when GET /api/admin/me confirmed the role. */
  isSuperOwner: boolean;
  /** True until the introspection call settles. */
  loading: boolean;
}

const SuperOwnerContext = createContext<SuperOwnerContextValue | null>(null);

export function SuperOwnerProvider({ children }: { children: ReactNode }) {
  const [isSuperOwner, setIsSuperOwner] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const res = await apiFetch("/api/admin/me");
        if (!mounted) return;
        if (res.ok) {
          const data = (await res.json()) as { isSuperOwner?: boolean };
          setIsSuperOwner(Boolean(data.isSuperOwner));
        } else {
          setIsSuperOwner(false);
        }
      } catch {
        // Network / parse failure → fail closed.
        if (mounted) setIsSuperOwner(false);
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  return (
    <SuperOwnerContext.Provider value={{ isSuperOwner, loading }}>
      {children}
    </SuperOwnerContext.Provider>
  );
}

/**
 * useSuperOwner — read the shared super_owner state. Outside a provider it
 * fails closed (`isSuperOwner: false`, not loading) so gates never flash
 * the console to an unprivileged user.
 */
export function useSuperOwner(): SuperOwnerContextValue {
  const ctx = useContext(SuperOwnerContext);
  if (!ctx) return { isSuperOwner: false, loading: false };
  return ctx;
}
