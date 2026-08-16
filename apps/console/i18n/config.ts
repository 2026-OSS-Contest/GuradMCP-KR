/**
 * Locale constants shared by the server config and the client control that switches it.
 *
 * They live apart from `request.ts` because that module pulls in `next/headers`, which a client
 * component cannot import — and the language select needs the cookie's name to set it.
 */
export const locales = ["ko", "en"] as const;
export type Locale = (typeof locales)[number];
export const defaultLocale: Locale = "ko";

/** next-intl reads this on the server; nothing but the language control should write it. */
export const LOCALE_COOKIE = "NEXT_LOCALE";
