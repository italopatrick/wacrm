"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { getCompany, type CompanyDetail } from "@/lib/admin/companies";
import { buttonVariants } from "@/components/ui/button";
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

  useEffect(() => {
    if (!id) return;
    let mounted = true;
    getCompany(id)
      .then((c) => mounted && setCompany(c))
      .catch(() => mounted && setError("Could not load this store."));
    return () => {
      mounted = false;
    };
  }, [id]);

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
          <div>
            <h1 className="text-2xl font-semibold">{company.name}</h1>
            <p className="text-sm text-muted-foreground">
              Created {new Date(company.created_at).toLocaleDateString()}
            </p>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Store owner</CardTitle>
              <CardDescription>
                The first user, created when the store was provisioned.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <p className="font-medium">{company.owner.full_name}</p>
              <p className="text-sm text-muted-foreground">
                {company.owner.email ?? "—"}
              </p>
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
