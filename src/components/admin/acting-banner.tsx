"use client";

import { useRouter } from "next/navigation";
import { ShieldAlert } from "lucide-react";

import { clearActing, useActing } from "@/lib/admin/acting";
import { Button } from "@/components/ui/button";

// ActingBanner shows a persistent "support mode" bar while a super_owner is
// acting inside a company (Feature B). It is intentionally blunt: acting only
// scopes backend (apiFetch) operations, so the copy warns that direct-Supabase
// views may not reflect the target company.
export function ActingBanner() {
  const acting = useActing();
  const router = useRouter();
  if (!acting) return null;

  function exit() {
    clearActing();
    router.push("/admin/companies");
  }

  return (
    <div className="flex items-center justify-between gap-3 border-b border-amber-500/40 bg-amber-500/10 px-4 py-2 text-sm text-amber-700 dark:text-amber-300">
      <div className="flex items-center gap-2">
        <ShieldAlert className="h-4 w-4 shrink-0" />
        <span>
          Modo suporte — gerenciando <strong>{acting.name}</strong>. Apenas
          operações via API respeitam este contexto.
        </span>
      </div>
      <Button
        size="sm"
        variant="outline"
        onClick={exit}
        className="border-amber-500/40"
      >
        Sair do modo suporte
      </Button>
    </div>
  );
}
