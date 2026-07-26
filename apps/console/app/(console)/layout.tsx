import type { ReactNode } from "react";
import { cookies } from "next/headers";
import { OverviewProvider } from "@/components/providers/overview-provider";
import { RailNav } from "@/components/shell/rail-nav";
import { StatusBar } from "@/components/shell/status-bar";
import { OfflineBanner } from "@/components/shell/offline-banner";
import { RAIL_COLLAPSED_COOKIE } from "@/lib/rail";

/** SCR-000 common shell: rail nav + status bar wrapping every console screen. */
export default async function ConsoleLayout({ children }: { children: ReactNode }) {
  const collapsed = (await cookies()).get(RAIL_COLLAPSED_COOKIE)?.value === "1";

  return (
    <OverviewProvider>
      <div className="flex h-screen bg-background text-foreground">
        <RailNav defaultCollapsed={collapsed} />
        <div className="flex min-w-0 flex-1 flex-col">
          <StatusBar />
          <OfflineBanner />
          <main className="flex min-h-0 flex-1 flex-col overflow-y-auto">{children}</main>
        </div>
      </div>
    </OverviewProvider>
  );
}
