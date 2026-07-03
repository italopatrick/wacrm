import 'server-only';

import { headers } from 'next/headers';
import Negotiator from 'negotiator';
import { match } from '@formatjs/intl-localematcher';

import { defaultLocale, locales, type Locale } from './config';

// ============================================================
// Server-side locale resolution from the request.
//
// We negotiate the best match between the browser's `Accept-Language`
// header and the locales we ship, falling back to `defaultLocale` when
// there's no overlap (or the header is missing/garbage). This runs on
// every request — `headers()` makes the caller dynamic, which is fine:
// the whole app is already dynamic (per-user auth cookies).
// ============================================================

export async function resolveLocale(): Promise<Locale> {
  const acceptLanguage = (await headers()).get('accept-language') ?? '';

  // Negotiator throws on a malformed header; a missing/empty header just
  // yields no languages. Either way we fall back to the default.
  let languages: string[] = [];
  try {
    languages = new Negotiator({
      headers: { 'accept-language': acceptLanguage },
    }).languages();
  } catch {
    languages = [];
  }

  try {
    // `match` returns `defaultLocale` when nothing overlaps, but still
    // throws on an invalid language tag in the list — guard it.
    return match(languages, locales as readonly string[], defaultLocale) as Locale;
  } catch {
    return defaultLocale;
  }
}
