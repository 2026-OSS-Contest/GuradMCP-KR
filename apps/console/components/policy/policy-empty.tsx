"use client";

import { useTranslations } from "next-intl";
import { ClipboardList } from "lucide-react";

/**
 * SCR-302 empty state. The wording, both links and the accessible names come from the UX copy
 * spec (`docs/ux/scr-302-empty-state.md`), which asks for them verbatim.
 *
 * Those paths are repository files, not application routes, so they resolve against `main` on
 * GitHub — the fallback that same spec names. The links open in a new tab, so their accessible
 * names say so, and nothing here is red or a dead toggle: an empty console is a starting point,
 * not a fault.
 */
const REPO_BLOB = "https://github.com/2026-OSS-Contest/GuradMCP-KR/blob/main";
const REPO_TREE = "https://github.com/2026-OSS-Contest/GuradMCP-KR/tree/main";

export function PolicyEmpty() {
  const t = useTranslations("policies.empty");

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 p-8 text-center">
      <span aria-hidden className="rounded-full bg-grayscale-800 p-4 text-grayscale-500">
        <ClipboardList className="size-6" />
      </span>
      <h2 className="text-body-text-b1-bd text-grayscale-white">{t("title")}</h2>
      <p className="text-body-text-b3-md max-w-prose text-grayscale-300">{t("body")}</p>
      <div className="mt-2 flex flex-wrap items-center justify-center gap-3">
        <a
          href={`${REPO_BLOB}/docs/policy-guide/README.md`}
          target="_blank"
          rel="noreferrer"
          aria-label={t("primaryAria")}
          className="text-body-text-b3-bd flex h-10 items-center rounded-(--primitive-radius-rounded-lg) bg-blue-800 px-5 text-grayscale-white transition-colors hover:bg-blue-700"
        >
          {t("primary")}
        </a>
        <a
          href={`${REPO_TREE}/policy-packs/default/`}
          target="_blank"
          rel="noreferrer"
          aria-label={t("secondaryAria")}
          className="text-body-text-b3-md flex h-10 items-center rounded-(--primitive-radius-rounded-lg) bg-(--primitive-opacity-white-alpha-6) px-5 text-grayscale-200 transition-colors hover:bg-white/10"
        >
          {t("secondary")}
        </a>
      </div>
      <p className="text-caption-text-c-rg text-grayscale-400">{t("note")}</p>
    </div>
  );
}
