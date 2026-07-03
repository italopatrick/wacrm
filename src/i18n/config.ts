// ============================================================
// i18n configuration — single source of truth for locales.
//
// The app auto-detects the visitor's language from the browser's
// `Accept-Language` header (see `resolveLocale`) — there is no manual
// language switcher and no locale segment in the URL. Keeping the app
// URL-stable was a deliberate choice: every route is behind auth and
// `robots: index:false`, so per-locale URLs would buy nothing and would
// force every route under `app/[locale]/` plus a locale-aware proxy.
// ============================================================

/** Every locale we ship a message catalog for (`src/messages/<locale>.json`). */
export const locales = ['en', 'pt', 'es'] as const;

export type Locale = (typeof locales)[number];

/** Fallback when the browser asks for a language we don't translate. */
export const defaultLocale: Locale = 'en';

/** Human labels — handy for a future switcher or a debug readout. */
export const localeNames: Record<Locale, string> = {
  en: 'English',
  pt: 'Português',
  es: 'Español',
};

export function isLocale(value: string): value is Locale {
  return (locales as readonly string[]).includes(value);
}
