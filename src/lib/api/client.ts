import { createClient } from '@/lib/supabase/client'

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? ''

/**
 * Thin wrapper around fetch that:
 *   1. Injects Authorization: Bearer <jwt> from the Supabase session when
 *      one is available (public routes like /invitations/.../peek work
 *      without a session — the header is simply omitted).
 *   2. Routes requests to the Go backend in one of two modes:
 *
 *      Direct mode  — NEXT_PUBLIC_API_URL is set (e.g. http://localhost:3001)
 *                     Strips the /api prefix and calls Go directly.
 *                     apiFetch('/api/automations') → http://go:3001/automations
 *
 *      Proxy mode   — NEXT_PUBLIC_API_URL is empty (default in docker-compose)
 *                     Keeps the /api prefix; nginx routes /api/* → Go.
 *                     apiFetch('/api/automations') → /api/automations → nginx → Go
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

  // Direct mode: strip /api prefix, prepend API_BASE (points to Go port).
  // Proxy mode: keep path as-is; nginx rewrites /api/* → /* on Go.
  const url = API_BASE ? API_BASE + path.replace(/^\/api/, '') : path

  return fetch(url, { ...init, headers })
}
