"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Check, Copy } from "lucide-react";
import type { DryRunStat, PolicyRow } from "@/lib/api/types";
import { cn } from "@/lib/utils";

/** How long the copy button stays acknowledged before returning to its idle icon. */
const COPIED_MS = 1_500;

/** Values the design inks red: the ones that say something is dangerous. */
const RISK_VALUES = new Set(["critical", "high", "block"]);

/** Keys whose value the design inks blue — the policy's identity, not its judgement. */
const IDENTITY_KEYS = new Set(["id", "priority", "version"]);

/**
 * The design highlights YAML *semantically*, not syntactically: keys and ordinary scalars are
 * all one grey, the policy's identity is blue, and anything naming danger — `critical`,
 * `block`, a detection type — is red. So this colours by meaning rather than reaching for a
 * highlighter dependency that would paint strings and numbers uniformly and miss the point.
 */
function inkFor(key: string | null, value: string): string {
  const bare = value.replace(/^['"]|['"]$/g, "");
  if (RISK_VALUES.has(bare)) return "text-red-500";
  // `detections.any_of: [SECRET, …]` and `- type: SECRET` both name detector vocabulary, which
  // is upper-case by construction.
  if (/^[A-Z][A-Z._]+$/.test(bare)) return "text-red-500";
  if (key && IDENTITY_KEYS.has(key)) return "text-blue-200";
  return "text-grayscale-300";
}

interface Line {
  indent: string;
  key: string | null;
  /** Everything after `key:`, or the whole line when it has no key. */
  value: string;
  comment: string | null;
}

function parse(yaml: string): Line[] {
  return yaml.split("\n").map((raw) => {
    const indent = raw.match(/^\s*/)?.[0] ?? "";
    const body = raw.slice(indent.length);
    if (body.startsWith("#")) return { indent, key: null, value: "", comment: body };
    const match = body.match(/^(-\s*)?([A-Za-z_][\w.]*):(.*)$/);
    if (!match) return { indent, key: null, value: body, comment: null };
    const [, dash = "", key, rest] = match;
    return { indent: indent + dash, key, value: rest.trim(), comment: null };
  });
}

export interface YamlPaneProps {
  policy: PolicyRow | null;
  yaml: string | undefined;
  loading: boolean;
  stats: DryRunStat[];
}

export function YamlPane({ policy, yaml, loading, stats }: YamlPaneProps) {
  const t = useTranslations("policies");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), COPIED_MS);
    return () => clearTimeout(timer);
  }, [copied]);

  const copy = async () => {
    if (!yaml) return;
    try {
      await navigator.clipboard.writeText(yaml);
      setCopied(true);
    } catch {
      // Clipboard access can be refused outright (insecure origin, denied permission). The YAML
      // is on screen and selectable, so there is nothing to recover from and nothing to say.
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <section aria-labelledby="yaml-title" className="flex flex-col gap-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-1">
            <h2 id="yaml-title" className="text-body-text-b3-md text-grayscale-300">
              {t("yaml.title")}
            </h2>
            {/* The control plane reports no source path, so the caption is simply absent there. */}
            {policy?.path && <p className="text-caption-mono-c-rg break-all text-grayscale-white">{policy.path}</p>}
          </div>
          <button
            type="button"
            onClick={copy}
            disabled={!yaml}
            aria-label={t("yaml.copy")}
            className={cn(
              "flex-none rounded-(--primitive-radius-rounded-lg) bg-grayscale-800 p-2 text-grayscale-200",
              "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600",
              yaml ? "cursor-pointer hover:text-grayscale-white" : "cursor-not-allowed opacity-40"
            )}
          >
            {copied ? <Check aria-hidden className="size-5" /> : <Copy aria-hidden className="size-5" />}
          </button>
        </div>

        <div className="rounded-(--primitive-radius-rounded-lg) bg-grayscale-900 p-4">
          {!policy ? (
            <p className="text-body-text-b3-rg text-grayscale-400">{t("yaml.none")}</p>
          ) : loading && !yaml ? (
            <p className="text-body-text-b3-rg text-grayscale-400">{t("yaml.loading")}</p>
          ) : (
            <pre className="text-body-mono-b3-rg overflow-x-auto whitespace-pre-wrap">
              <code>
                {parse(yaml ?? "").map((line, index) => (
                  <span key={index} className="block">
                    {line.comment ? (
                      <span className="text-grayscale-500">
                        {line.indent}
                        {line.comment}
                      </span>
                    ) : line.key ? (
                      <>
                        <span className="text-grayscale-300">
                          {line.indent}
                          {line.key}:
                        </span>
                        {line.value && <span className={inkFor(line.key, line.value)}> {line.value}</span>}
                      </>
                    ) : (
                      <span className={inkFor(null, line.value)}>
                        {line.indent}
                        {line.value}
                      </span>
                    )}
                  </span>
                ))}
              </code>
            </pre>
          )}
        </div>
      </section>

      <section aria-labelledby="dry-run-title" className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between gap-3 border-b border-grayscale-800 pb-3">
          <h2 id="dry-run-title" className="text-body-text-b3-md text-grayscale-white">
            {t("dryRun.title")}
          </h2>
          <span className="text-caption-text-c-rg text-grayscale-300">{t("dryRun.window", { days: 30 })}</span>
        </div>
        {stats.length === 0 ? (
          <p className="text-body-text-b3-rg text-grayscale-400">{t("dryRun.none")}</p>
        ) : (
          <ul className="flex flex-col">
            {stats.map((stat) => (
              <li
                key={stat.policyId}
                className="flex items-baseline justify-between gap-3 border-b border-grayscale-800 py-3"
              >
                <span className="text-body-mono-b3-rg min-w-0 break-all text-grayscale-200">{stat.policyId}</span>
                <span className="text-caption-text-c-md flex-none text-grayscale-300">
                  {t("dryRun.wouldFire")} <span className="text-body-text-b3-bd text-grayscale-white">{stat.wouldFire}</span>{" "}
                  {t("dryRun.unit")}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
