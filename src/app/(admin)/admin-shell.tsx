"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Building2, LogOut } from "lucide-react";

import { AuthProvider, useAuth } from "@/hooks/use-auth";
import { SuperOwnerProvider, useSuperOwner } from "@/hooks/use-super-owner";
import { Button } from "@/components/ui/button";

// Auth-gated shell for the platform super_owner console. Mirrors
// DashboardShell: a client component that redirects, kept out of the
// server layout so the layout can export metadata.
//
// Two gates, both client-side (the backend enforces real authz on every
// /api/admin/* call):
//   - no Supabase session      → /login
//   - session but not super_owner → /dashboard
function AdminShellInner({ children }: { children: React.ReactNode }) {
  const { user, loading, signOut } = useAuth();
  const { isSuperOwner, loading: soLoading } = useSuperOwner();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    if (!user) {
      router.push("/login");
      return;
    }
    if (!soLoading && !isSuperOwner) {
      router.push("/dashboard");
    }
  }, [user, loading, isSuperOwner, soLoading, router]);

  if (loading || soLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          <p className="text-sm text-muted-foreground">Loading…</p>
        </div>
      </div>
    );
  }

  // Fail closed while the redirect effect runs.
  if (!user || !isSuperOwner) return null;

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background">
      <header className="flex items-center justify-between border-b border-border px-4 py-3 sm:px-6">
        <Link href="/admin/companies" className="flex items-center gap-2">
          <Building2 className="h-5 w-5 text-primary" />
          <span className="font-semibold">Super owner</span>
          <span className="text-muted-foreground">· Stores</span>
        </Link>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            void signOut();
          }}
        >
          <LogOut className="mr-2 h-4 w-4" />
          Sign out
        </Button>
      </header>
      <main className="flex-1 overflow-y-auto p-4 sm:p-6">{children}</main>
    </div>
  );
}

export function AdminShell({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <SuperOwnerProvider>
        <AdminShellInner>{children}</AdminShellInner>
      </SuperOwnerProvider>
    </AuthProvider>
  );
}
