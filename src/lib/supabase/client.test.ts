// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import { guardActingWrites } from "./client";
import { clearActing, setActing } from "@/lib/admin/acting";

vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

// Fake PostgREST-ish builder: mutating methods return a sentinel; reads/filters
// chain. Enough to prove the guard intercepts only mutations.
function fakeClient() {
  const builder = {
    insert: () => "inserted",
    update: () => "updated",
    delete: () => "deleted",
    upsert: () => "upserted",
    select: () => "selected",
    eq() {
      return this;
    },
  };
  return { from: (_t: string) => builder } as unknown as SupabaseClient;
}

afterEach(() => clearActing());

describe("guardActingWrites", () => {
  it("passes mutations through when NOT acting", () => {
    const c = guardActingWrites(fakeClient());
    expect((c.from("pipelines") as never as { insert: () => string }).insert()).toBe("inserted");
  });

  it("blocks mutations while acting, allows reads", () => {
    const c = guardActingWrites(fakeClient());
    setActing({ id: "acc-1", name: "Target" });

    const qb = c.from("pipelines") as never as {
      insert: () => string;
      update: () => string;
      delete: () => string;
      upsert: () => string;
      select: () => string;
    };
    expect(() => qb.insert()).toThrow(/blocked/);
    expect(() => qb.update()).toThrow(/blocked/);
    expect(() => qb.delete()).toThrow(/blocked/);
    expect(() => qb.upsert()).toThrow(/blocked/);
    // reads still work under acting
    expect(qb.select()).toBe("selected");
  });
});
