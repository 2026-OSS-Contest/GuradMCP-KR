import { getRequestConfig } from "next-intl/server";
import { cookies } from "next/headers";
import { LOCALE_COOKIE, defaultLocale, locales, type Locale } from "./config";

export { LOCALE_COOKIE, defaultLocale, locales, type Locale };

function resolveLocale(value: string | undefined): Locale {
  return locales.includes(value as Locale) ? (value as Locale) : defaultLocale;
}

export default getRequestConfig(async () => {
  const store = await cookies();
  const locale = resolveLocale(store.get(LOCALE_COOKIE)?.value);
  return {
    locale,
    messages: (await import(`../messages/${locale}.json`)).default
  };
});
