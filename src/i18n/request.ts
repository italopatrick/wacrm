import { getRequestConfig } from 'next-intl/server';

import { resolveLocale } from './locale';

// ============================================================
// next-intl request config (wired via `createNextIntlPlugin` in
// next.config.ts). Runs per request on the server: pick the locale from
// the browser, load that catalog, hand both to next-intl. There is no
// i18n routing, so we ignore `requestLocale` and resolve it ourselves.
// ============================================================

export default getRequestConfig(async () => {
  const locale = await resolveLocale();

  return {
    locale,
    messages: (await import(`../messages/${locale}.json`)).default,
  };
});
