import type { ReactNode } from "react";
import { cookies } from "next/headers";
import { RailNav } from "@/components/shell/rail-nav";
import { StatusBar } from "@/components/shell/status-bar";
import { RAIL_COLLAPSED_COOKIE } from "@/lib/rail";

/** SCR-000 common shell: rail nav + status bar wrapping every console screen. */
export default async function ConsoleLayout({ children }: { children: ReactNode }) {
  const collapsed = (await cookies()).get(RAIL_COLLAPSED_COOKIE)?.value === "1";

  return (
    <div className="flex min-h-screen bg-background text-foreground">
      <RailNav defaultCollapsed={collapsed} />
      <div className="flex min-w-0 flex-1 flex-col">
        <StatusBar />
        <main className="flex-1 p-8">{children}</main>
      </div>
    </div>
  );
}
