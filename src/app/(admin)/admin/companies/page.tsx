"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Plus } from "lucide-react";

import { listCompanies, type CompanySummary } from "@/lib/admin/companies";
import { buttonVariants } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export default function CompaniesListPage() {
  const [companies, setCompanies] = useState<CompanySummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    listCompanies()
      .then((rows) => mounted && setCompanies(rows))
      .catch(() => mounted && setError("Could not load stores. Try again."));
    return () => {
      mounted = false;
    };
  }, []);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Stores</h1>
          <p className="text-sm text-muted-foreground">
            Every tenant on the platform. Each store has its own isolated data.
          </p>
        </div>
        <Link href="/admin/companies/new" className={buttonVariants()}>
          <Plus className="mr-2 h-4 w-4" />
          New store
        </Link>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {companies === null && !error && (
        <p className="text-sm text-muted-foreground">Loading…</p>
      )}

      {companies !== null && companies.length === 0 && (
        <div className="rounded-lg border border-dashed border-border p-10 text-center">
          <p className="text-sm text-muted-foreground">
            No stores yet — provision the first one.
          </p>
        </div>
      )}

      {companies !== null && companies.length > 0 && (
        <div className="rounded-lg border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Owner</TableHead>
                <TableHead className="text-right">Members</TableHead>
                <TableHead>Created</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {companies.map((c) => (
                <TableRow key={c.id}>
                  <TableCell>
                    <Link
                      href={`/admin/companies/${c.id}`}
                      className="font-medium text-primary hover:underline"
                    >
                      {c.name}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <span className="block">{c.owner.full_name}</span>
                    <span className="block text-xs text-muted-foreground">
                      {c.owner.email ?? "—"}
                    </span>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {c.member_count}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {new Date(c.created_at).toLocaleDateString()}
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
