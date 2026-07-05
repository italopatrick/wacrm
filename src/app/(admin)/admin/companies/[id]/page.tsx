"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { toast } from "sonner";
import { ArrowLeft, Loader2, Mail } from "lucide-react";

import {
  getCompany,
  suspendCompany,
  reactivateCompany,
  resendInvite,
  type CompanyDetail,
} from "@/lib/admin/companies";
import { Button, buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export default function CompanyDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const [company, setCompany] = useState<CompanyDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const [resending, setResending] = useState(false);

  const load = useCallback(async () => {
    try {
      setCompany(await getCompany(id));
    } catch {
      setError("Could not load this store.");
    }
  }, [id]);

  useEffect(() => {
    if (id) void load();
  }, [id, load]);

  const suspended = company?.status === "suspended";

  async function toggleStatus() {
    if (!company) return;
    setWorking(true);
    try {
      if (suspended) {
        await reactivateCompany(company.id);
        toast.success("Store reactivated");
      } else {
        await suspendCompany(company.id);
        toast.success("Store suspended");
      }
      await load();
    } catch {
      toast.error("Could not update the store. Try again?");
    } finally {
      setWorking(false);
    }
  }

  async function handleResendInvite() {
    if (!company) return;
    setResending(true);
    try {
      await resendInvite(company.id);
      toast.success("Invite email sent");
    } catch {
      toast.error("Could not send the invite. Try again?");
    } finally {
      setResending(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Link
        href="/admin/companies"
        className={buttonVariants({ variant: "ghost", size: "sm" })}
      >
        <ArrowLeft className="mr-2 h-4 w-4" />
        Back to stores
      </Link>

      {error && <p className="text-sm text-destructive">{error}</p>}
      {!company && !error && (
        <p className="text-sm text-muted-foreground">Loading…</p>
      )}

      {company && (
        <>
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-3">
                <h1 className="text-2xl font-semibold">{company.name}</h1>
                <Badge
                  variant={suspended ? "destructive" : "secondary"}
                  className="capitalize"
                >
                  {company.status}
                </Badge>
              </div>
              <p className="text-sm text-muted-foreground">
                Created {new Date(company.created_at).toLocaleDateString()}
              </p>
            </div>
            <Button
              variant={suspended ? "default" : "destructive"}
              onClick={toggleStatus}
              disabled={working}
            >
              {working && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {suspended ? "Reactivate" : "Suspend"}
            </Button>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Store owner</CardTitle>
              <CardDescription>
                The first user, created when the store was provisioned.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex items-start justify-between gap-4">
              <div>
                <p className="font-medium">{company.owner.full_name}</p>
                <p className="text-sm text-muted-foreground">
                  {company.owner.email ?? "—"}
                </p>
              </div>
              {company.owner.email && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleResendInvite}
                  disabled={resending}
                >
                  {resending ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Mail className="mr-2 h-4 w-4" />
                  )}
                  Resend invite
                </Button>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Members</CardTitle>
              <CardDescription>
                Members are managed by the store&rsquo;s own admins in Settings
                → Members.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Joined</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {company.members.map((m, i) => (
                    <TableRow key={`${m.full_name}-${i}`}>
                      <TableCell className="font-medium">
                        {m.full_name}
                      </TableCell>
                      <TableCell className="capitalize">{m.role}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {new Date(m.joined_at).toLocaleDateString()}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
