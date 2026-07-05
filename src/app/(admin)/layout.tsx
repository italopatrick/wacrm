import type { Metadata } from "next";

import { AdminShell } from "./admin-shell";

// Server layout: declares "do not index" for the platform admin console
// and delegates the auth gate to the client AdminShell (client components
// can't export Next's metadata object). Mirrors (dashboard)/layout.tsx.
export const metadata: Metadata = {
  title: "Admin",
  robots: {
    index: false,
    follow: false,
    nocache: true,
    googleBot: { index: false, follow: false, noimageindex: true },
  },
};

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <AdminShell>{children}</AdminShell>;
}
