import { createBrowserClient } from '@supabase/ssr'
import type { SupabaseClient } from '@supabase/supabase-js'
import { toast } from 'sonner'

import { getActing } from '@/lib/admin/acting'

// Singleton instance — one client shared across the whole browser session.
// Creating multiple clients causes auth-lock contention ("Lock was released
// because another request stole it") and intermittent fetch failures.
let browserClient: SupabaseClient | undefined

export function createClient() {
  if (browserClient) return browserClient

  browserClient = guardActingWrites(
    createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    )
  )

  return browserClient
}

const mutations = new Set(['insert', 'update', 'delete', 'upsert'])

// guardActingWrites blocks direct Supabase mutations while a super_owner is in
// acting/support mode (Feature B). Those writes carry the super_owner's OWN RLS
// scope, not the target company's — so a super_owner who is also a store member
// could silently write to their own store. The acting header only scopes
// backend (apiFetch) routes; until every settings write is routed through the
// backend, blocking direct writes is the safe default. Reads are non-destructive
// and RLS-limited, so they pass through. No-op when not acting.
export function guardActingWrites(client: SupabaseClient): SupabaseClient {
  const origFrom = client.from.bind(client)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client.from = ((relation: string) => {
    const builder = origFrom(relation)
    return new Proxy(builder as object, {
      get(target, prop, receiver) {
        if (typeof prop === 'string' && mutations.has(prop) && getActing()) {
          return () => {
            toast.error(
              'Support mode: direct edits are disabled — exit support mode to edit your own store.'
            )
            throw new Error('acting: direct Supabase write blocked')
          }
        }
        return Reflect.get(target, prop, receiver)
      },
    })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }) as any

  return client
}
