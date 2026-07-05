"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowLeft, Loader2 } from "lucide-react";

import { createCompany } from "@/lib/admin/companies";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function NewCompanyPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [ownerFullName, setOwnerFullName] = useState("");
  const [ownerEmail, setOwnerEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setFieldErrors({});
    try {
      const result = await createCompany({
        name: name.trim(),
        ownerEmail: ownerEmail.trim(),
        ownerFullName: ownerFullName.trim(),
      });
      switch (result.kind) {
        case "ok":
          toast.success(`Store created — invite sent to ${ownerEmail.trim()}`);
          router.push("/admin/companies");
          return;
        case "fieldErrors":
          setFieldErrors(result.fields);
          if (Object.keys(result.fields).length === 0) {
            toast.error("Please check the form and try again");
          }
          return;
        case "conflict":
          setFieldErrors({ ownerEmail: result.message });
          return;
        case "error":
          toast.error(result.message);
          return;
      }
    } catch {
      toast.error("Could not reach the server. Try again?");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <Link
        href="/admin/companies"
        className={buttonVariants({ variant: "ghost", size: "sm" })}
      >
        <ArrowLeft className="mr-2 h-4 w-4" />
        Back to stores
      </Link>

      <div>
        <h1 className="text-2xl font-semibold">New store</h1>
        <p className="text-sm text-muted-foreground">
          Creates a tenant and its first owner. The owner receives an email to
          set their password. They then invite their own team.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-5">
        <div className="space-y-1.5">
          <Label htmlFor="name">Store name</Label>
          <Input
            id="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={120}
            placeholder="Acme Ltda"
            aria-invalid={Boolean(fieldErrors.name)}
          />
          {fieldErrors.name && (
            <p className="text-xs text-destructive">{fieldErrors.name}</p>
          )}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="ownerFullName">Owner full name</Label>
          <Input
            id="ownerFullName"
            value={ownerFullName}
            onChange={(e) => setOwnerFullName(e.target.value)}
            placeholder="Ana Souza"
            aria-invalid={Boolean(fieldErrors.ownerFullName)}
          />
          {fieldErrors.ownerFullName && (
            <p className="text-xs text-destructive">
              {fieldErrors.ownerFullName}
            </p>
          )}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="ownerEmail">Owner email</Label>
          <Input
            id="ownerEmail"
            type="email"
            value={ownerEmail}
            onChange={(e) => setOwnerEmail(e.target.value)}
            placeholder="ana@acme.com"
            aria-invalid={Boolean(fieldErrors.ownerEmail)}
          />
          {fieldErrors.ownerEmail && (
            <p className="text-xs text-destructive">{fieldErrors.ownerEmail}</p>
          )}
        </div>

        <div className="flex justify-end gap-2">
          <Link
            href="/admin/companies"
            className={buttonVariants({ variant: "outline" })}
          >
            Cancel
          </Link>
          <Button type="submit" disabled={submitting}>
            {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Create store
          </Button>
        </div>
      </form>
    </div>
  );
}
