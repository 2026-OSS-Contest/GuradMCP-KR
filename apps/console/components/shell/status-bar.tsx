import { getTranslations } from "next-intl/server";
import { ChevronDown, Pause } from "lucide-react";

/** SCR-000 status bar — "보호 중" (protected) state, pixel-matched to Figma.
 *  Live protection state (GET /overview, SSE gateway.health) is wired in a follow-up issue. */
export async function StatusBar() {
  const t = await getTranslations("shell");

  return (
    <header className="flex h-15 flex-none items-center gap-4 bg-grayscale-950 px-8">
      <div className="flex items-center gap-3">
        <span className="flex items-center gap-2">
          <span className="size-2.5 rounded-full bg-verdict-allow" aria-hidden />
          <span className="text-sm font-semibold text-verdict-allow">{t("protected")}</span>
        </span>

        <span className="h-5 w-px bg-white/15" aria-hidden />

        <span className="flex items-center gap-3">
          <span className="text-sm text-muted-foreground">{t("policyPacks")}</span>
          <span className="rounded-md border border-white/10 bg-white/5 px-2 py-1 font-mono text-xs">default</span>
          <span className="rounded-md border border-white/10 bg-white/5 px-2 py-1 font-mono text-xs">korean-pii</span>
        </span>

        <span className="h-5 w-px bg-white/15" aria-hidden />

        <span className="flex items-center gap-1.5 rounded-full bg-(--primitive-opacity-require-approval-alpha-25) px-2 py-0.5 text-xs font-medium text-violet-200">
          <Pause className="size-3 fill-current" aria-hidden />
          {t("pendingApprovals")} 2
        </span>
      </div>

      <div className="flex-1" />

      <button
        type="button"
        className="flex h-8 items-center gap-2 rounded-lg bg-(--primitive-opacity-white-alpha-6) pr-1 pl-3 text-sm transition-colors hover:bg-white/10"
      >
        <span className="text-muted-foreground">{t("session")}</span>
        <b className="font-mono font-semibold">#s-0712</b>
        <ChevronDown className="size-4 opacity-70" aria-hidden />
      </button>
    </header>
  );
}
