"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { CtaChevronIcon, QuickStartFlowArrowIcon, QuickStartShieldIcon } from "@/components/icons";
import { Tag } from "@/components/ui/tag";

/**
 * SCR-101 empty state: no upstream server is registered yet, so the three onboarding steps
 * replace the dashboard entirely (spec §5.1 "빈 상태").
 */
export function QuickStart({ policyPacks }: { policyPacks: string[] }) {
  const t = useTranslations("gateway.quickStart");
  const tCta = useTranslations("gateway.cta");

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-8">
      <div className="flex flex-col items-center gap-4">
        <QuickStartShieldIcon className="size-10 flex-none" aria-hidden />
        <div className="flex flex-col items-center gap-2 text-center">
          <h2 className="text-title-text-t2-bd">{t("title")}</h2>
          <p className="text-body-text-b2-md text-grayscale-300">{t("desc")}</p>
        </div>
      </div>

      <div className="flex gap-4">
        <StepCard step={1} title={t("step1.title")} desc={t("step1.desc")}>
          {/* Wraps between the parts, never inside them — a broken-up "GuardMCP-KR" reads as a typo. */}
          <span className="flex flex-wrap items-center justify-center gap-2 whitespace-nowrap">
            <span className="text-body-text-b3-md text-grayscale-300">AI Agent</span>
            <QuickStartFlowArrowIcon className="h-2 w-[17px] flex-none" aria-hidden />
            <span className="rounded-sm bg-blue-800 px-2 py-1 text-body-text-b3-bd">GuardMCP-KR</span>
            <QuickStartFlowArrowIcon className="h-2 w-[17px] flex-none" aria-hidden />
            <span className="text-body-mono-b3-rg text-grayscale-300">server</span>
          </span>
        </StepCard>

        <StepCard step={2} title={t("step2.title")} desc={t("step2.desc")}>
          <span className="flex flex-wrap items-center justify-center gap-3">
            <span className="text-body-text-b3-md text-grayscale-300">{t("policyPacks")}</span>
            <span className="flex items-center gap-2">
              {policyPacks.map((pack) => (
                <Tag key={pack} className="text-caption-mono-c-rg">
                  {pack}
                </Tag>
              ))}
            </span>
          </span>
        </StepCard>

        <StepCard step={3} title={t("step3.title")} desc={t("step3.desc")}>
          <Link
            href="/demo"
            className="flex h-12 items-center gap-2 rounded-xl bg-blue-800 px-6 text-body-text-b2-md transition-colors hover:bg-blue-700"
          >
            {tCta("demo")}
            <CtaChevronIcon className="h-6 w-5 flex-none" aria-hidden />
          </Link>
        </StepCard>
      </div>
    </div>
  );
}

function StepCard({
  step,
  title,
  desc,
  children
}: {
  step: number;
  title: string;
  desc: string;
  children: ReactNode;
}) {
  return (
    <section className="flex w-[315px] flex-col gap-8 rounded-3xl bg-grayscale-900 px-6 py-8">
      <div className="flex flex-1 flex-col gap-2">
        <h3 className="flex items-center gap-2 text-body-text-b1-bd">
          <span className="flex size-[25px] flex-none items-center justify-center rounded-full bg-(--primitive-opacity-white-alpha-6) text-body-text-b3-bd">
            {step}
          </span>
          {title}
        </h3>
        <p className="text-body-text-b3-md text-grayscale-300">{desc}</p>
      </div>

      <div className="flex flex-1 items-center justify-center rounded-lg bg-(--primitive-opacity-black-alpha-25) px-4 py-3">
        {children}
      </div>
    </section>
  );
}
