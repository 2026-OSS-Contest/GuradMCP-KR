import { getRequestConfig } from "next-intl/server";
import { cookies } from "next/headers";

export const locales = ["ko", "en"] as const;
export type Locale = (typeof locales)[number];
export const defaultLocale: Locale = "ko";
export const LOCALE_COOKIE = "NEXT_LOCALE";

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
