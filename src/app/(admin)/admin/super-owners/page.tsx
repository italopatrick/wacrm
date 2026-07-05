"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, Trash2, UserPlus } from "lucide-react";

import {
  listSuperOwners,
  grantSuperOwner,
  revokeSuperOwner,
  type SuperOwner,
} from "@/lib/admin/companies";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export default function SuperOwnersPage() {
  const [owners, setOwners] = useState<SuperOwner[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [granting, setGranting] = useState(false);
  const [revoking, setRevoking] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setOwners(await listSuperOwners());
    } catch {
      setError("Could not load super owners.");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleGrant(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = email.trim();
    if (!trimmed) return;
    setGranting(true);
    try {
      const result = await grantSuperOwner(trimmed);
      switch (result.kind) {
        case "ok":
          toast.success("Super owner granted");
          setEmail("");
          await load();
          break;
        case "notFound":
          toast.error(result.message);
          break;
        case "error":
          toast.error(result.message);
          break;
      }
    } catch {
      toast.error("Could not reach the server. Try again?");
    } finally {
      setGranting(false);
    }
  }

  async function handleRevoke(userId: string) {
    setRevoking(userId);
    try {
      const result = await revokeSuperOwner(userId);
      switch (result.kind) {
        case "ok":
          toast.success("Super owner revoked");
          await load();
          break;
        case "lastOwner":
          toast.error(result.message);
          break;
        case "error":
          toast.error(result.message);
          break;
      }
    } catch {
      toast.error("Could not reach the server. Try again?");
    } finally {
      setRevoking(null);
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Super owners</h1>
        <p className="text-sm text-muted-foreground">
          Platform administrators who can provision stores. The last one
          cannot be removed.
        </p>
      </div>

      <form
        onSubmit={handleGrant}
        className="flex items-end gap-3 rounded-lg border border-border p-4"
      >
        <div className="flex-1 space-y-1.5">
          <Label htmlFor="email">Grant by email</Label>
          <Input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="person@company.com"
          />
        </div>
        <Button type="submit" disabled={granting || !email.trim()}>
          {granting ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <UserPlus className="mr-2 h-4 w-4" />
          )}
          Grant
        </Button>
      </form>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {owners === null && !error && (
        <p className="text-sm text-muted-foreground">Loading…</p>
      )}

      {owners !== null && (
        <div className="rounded-lg border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Granted</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {owners.map((o) => (
                <TableRow key={o.user_id}>
                  <TableCell className="font-medium">
                    {o.full_name ?? "—"}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {o.email ?? "—"}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {new Date(o.granted_at).toLocaleDateString()}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleRevoke(o.user_id)}
                      disabled={revoking === o.user_id || owners.length <= 1}
                      title={
                        owners.length <= 1
                          ? "Cannot remove the last super owner"
                          : "Revoke"
                      }
                    >
                      {revoking === o.user_id ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Trash2 className="h-4 w-4" />
                      )}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
