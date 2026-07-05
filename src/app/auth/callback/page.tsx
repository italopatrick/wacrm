"use client";

// ============================================================
// /auth/callback — turns a Supabase email link into a session, then
// forwards to `next`.
//
// Handles both transports a Supabase auth email can use:
//   - PKCE:      ?code=…            (recovery initiated in this browser)
//   - implicit:  #access_token=…    (admin-generated invite — no verifier)
// The hash is only readable client-side, so this is a client page rather
// than a route handler. `detectSessionInUrl` (on by default) may resolve
// the link on its own; we listen for that and also try explicitly, then
// fall through to the login page if nothing produced a session.
// ============================================================

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

import { createClient } from "@/lib/supabase/client";

// Only allow same-origin relative redirects (no open redirect).
function safeNext(raw: string | null): string {
  if (raw && raw.startsWith("/") && !raw.startsWith("//")) return raw;
  return "/dashboard";
}

export default function AuthCallbackPage() {
  const t = useTranslations("auth.resetPassword");
  const router = useRouter();
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    const params = new URLSearchParams(window.location.search);
    const next = safeNext(params.get("next"));

    let done = false;
    const finish = (ok: boolean) => {
      if (done) return;
      done = true;
      if (ok) router.replace(next);
      else setFailed(true);
    };

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) finish(true);
    });

    (async () => {
      const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
      const accessToken = hash.get("access_token");
      const refreshToken = hash.get("refresh_token");
      const code = params.get("code");
      try {
        if (accessToken && refreshToken) {
          await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken,
          });
        } else if (code) {
          await supabase.auth.exchangeCodeForSession(code);
        }
      } catch {
        // May already have been consumed by detectSessionInUrl — fall
        // through to the getSession check below.
      }
      const { data } = await supabase.auth.getSession();
      finish(Boolean(data.session));
    })();

    // Fallback so we never spin forever on a bad/expired link.
    const timer = setTimeout(() => finish(false), 8000);

    return () => {
      sub.subscription.unsubscribe();
      clearTimeout(timer);
    };
  }, [router]);

  useEffect(() => {
    if (failed) router.replace("/login?error=auth_callback");
  }, [failed, router]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="flex flex-col items-center gap-3">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        <p className="text-sm text-muted-foreground">{t("verifying")}</p>
      </div>
    </div>
  );
}
