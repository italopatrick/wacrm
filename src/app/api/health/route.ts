// ============================================================
// GET /api/health — container liveness probe.
//
// Deliberately dependency-free: it proves the Node process is up and
// serving HTTP, nothing more. It does NOT touch Supabase or any other
// external service — a healthcheck that fails on a transient database
// blip would make the orchestrator (EasyPanel / Docker) kill and
// restart a container that is actually fine, turning a downstream
// hiccup into an outage. Readiness of dependencies is a separate
// concern from process liveness.
//
// `force-dynamic` keeps it out of the build-time prerender so every
// hit runs fresh (and the `time` reflects the request, not the build).
// ============================================================

export const dynamic = 'force-dynamic';

export function GET() {
  return Response.json({ status: 'ok', time: new Date().toISOString() });
}
