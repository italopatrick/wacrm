import { createClient } from '@/lib/supabase/client'

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? ''

/**
 * Thin wrapper around fetch that:
 *   1. Prepends NEXT_PUBLIC_API_URL to every path (strips /api prefix).
 *   2. Injects Authorization: Bearer <jwt> from the Supabase session when
 *      one is available (public routes like /invitations/.../peek work
 *      without a session — the header is simply omitted).
 *
 * Usage (drop-in for fetch):
 *   const res = await apiFetch('/api/automations', { method: 'POST', body: ... })
 */
export async function apiFetch(
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const { data } = await createClient().auth.getSession()
  const token = data.session?.access_token

  const headers = new Headers(init.headers)
  if (token) {
    headers.set('Authorization', `Bearer ${token}`)
  }
  if (!headers.has('Content-Type') && init.body) {
    headers.set('Content-Type', 'application/json')
  }

  // Strip /api prefix when routing to the Go backend.
  const url = API_BASE + path.replace(/^\/api/, '')

  return fetch(url, { ...init, headers })
}
