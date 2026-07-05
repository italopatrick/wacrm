// safeNext guards the post-auth redirect target against open redirects:
// only same-origin relative paths are allowed. Extracted verbatim from
// `src/app/auth/callback/page.tsx` (ADR-3) so it is unit-testable without a
// DOM. Behavior is unchanged — do not add logic here.
export function safeNext(raw: string | null): string {
  if (raw && raw.startsWith("/") && !raw.startsWith("//")) return raw;
  return "/dashboard";
}
