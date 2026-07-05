"use client";

// Acting-as-company state for the platform super_owner console (Feature B).
// When set, apiFetch attaches `X-Act-As-Account: <id>` so backend dashboard
// routes operate inside the target company (the backend honors it only for
// verified super_owners).
//
// LIMITATION: this scopes only backend-mediated (apiFetch) calls. Parts of the
// dashboard read/write Supabase directly (e.g. AI config), which the header
// does NOT affect — those remain in the caller's own RLS scope. Do not treat
// acting as full impersonation until those paths are routed through the backend.

import { useEffect, useState } from "react";

export type Acting = { id: string; name: string };

const KEY = "ulab.acting";
const EVENT = "ulab:acting-change";

// getActing reads the current acting target synchronously (used by apiFetch).
export function getActing(): Acting | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Acting) : null;
  } catch {
    return null;
  }
}

export function setActing(a: Acting): void {
  window.localStorage.setItem(KEY, JSON.stringify(a));
  window.dispatchEvent(new Event(EVENT));
}

export function clearActing(): void {
  window.localStorage.removeItem(KEY);
  window.dispatchEvent(new Event(EVENT));
}

// useActing subscribes to acting changes (same tab via EVENT, cross-tab via
// the native `storage` event).
export function useActing(): Acting | null {
  const [acting, setActingState] = useState<Acting | null>(null);
  useEffect(() => {
    const sync = () => setActingState(getActing());
    sync();
    window.addEventListener(EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);
  return acting;
}
