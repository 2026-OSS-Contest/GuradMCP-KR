"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { ChevronsLeft, ChevronsRight } from "lucide-react";
import { navItems } from "@/lib/nav";
import { RAIL_COLLAPSED_COOKIE } from "@/lib/rail";
import { cn } from "@/lib/utils";
import { Logo } from "./logo";

function persist(collapsed: boolean) {
  document.cookie = `${RAIL_COLLAPSED_COOKIE}=${collapsed ? "1" : "0"}; path=/; max-age=31536000; samesite=lax`;
}

export function RailNav({ defaultCollapsed = false }: { defaultCollapsed?: boolean }) {
  const pathname = usePathname();
  const t = useTranslations("nav");
  const tShell = useTranslations("shell");
  const [collapsed, setCollapsed] = useState(defaultCollapsed);

  const toggle = () =>
    setCollapsed((prev) => {
      const next = !prev;
      persist(next);
      return next;
    });

  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));

  return (
    <aside
      className={cn(
        // The design gives the rail a right-hand rule, drawn inside its 240px width.
        "flex flex-none flex-col gap-4 bg-grayscale-black p-3 shadow-[inset_-1px_0_0_0_var(--primitive-color-grayscale-800)] transition-[width] duration-200",
        collapsed ? "w-18" : "w-60"
      )}
    >
      <div className={cn("flex h-12 items-center p-2", collapsed && "justify-center")}>
        <Logo iconOnly={collapsed} />
      </div>

      <nav className="flex flex-col gap-3">
        {navItems.map(({ key, href, icon: Icon }) => {
          const active = isActive(href);
          return (
            <Link
              key={key}
              href={href}
              aria-current={active ? "page" : undefined}
              title={collapsed ? t(key) : undefined}
              className={cn(
                "flex h-10 items-center gap-3 rounded-lg p-2 text-grayscale-100 transition-colors hover:bg-white/5",
                collapsed && "justify-center",
                active && "bg-(--primitive-opacity-blue-alpha-25) text-foreground"
              )}
            >
              <span className="flex size-6 flex-none items-center justify-center">
                <Icon aria-hidden />
              </span>
              {!collapsed && <span className="text-body-text-b2-md">{t(key)}</span>}
            </Link>
          );
        })}
      </nav>

      <button
        type="button"
        onClick={toggle}
        aria-label={tShell(collapsed ? "expand" : "collapse")}
        aria-pressed={collapsed}
        className={cn(
          "mt-auto flex h-6 items-center p-2 text-white/60 transition-colors hover:text-white",
          collapsed ? "justify-center" : "justify-end"
        )}
      >
        {collapsed ? <ChevronsRight className="size-5" /> : <ChevronsLeft className="size-5" />}
      </button>
    </aside>
  );
}
