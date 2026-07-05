import { redirect } from "next/navigation";

// /admin has no page of its own — send it to the console landing.
// The gate lives in the (admin) shell; this only fixes the bare-path 404.
export default function AdminIndexPage() {
  redirect("/admin/companies");
}
