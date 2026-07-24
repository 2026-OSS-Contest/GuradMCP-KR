import type { Metadata } from "next";
import type { ReactNode } from "react";
import { NextIntlClientProvider } from "next-intl";
import { getLocale } from "next-intl/server";
import { MockApiProvider } from "@/components/dev/mock-api-provider";
import { ScenarioSwitcher } from "@/components/dev/scenario-switcher";
import "./globals.css";

export const metadata: Metadata = { title: "GuardMCP-KR Console", description: "Every tool call, inspected." };

export default async function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  const locale = await getLocale();
  return (
    <html lang={locale} suppressHydrationWarning>
      <body>
        <NextIntlClientProvider>
          <MockApiProvider>{children}</MockApiProvider>
          <ScenarioSwitcher />
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
