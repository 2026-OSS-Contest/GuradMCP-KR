"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import type { PolicyPack } from "@/lib/api/types";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

/** `default@^1.0.0` names the pack `default`; the range matters to the loader, not to the tree. */
function parentName(range: string): string {
  return range.split("@")[0];
}

interface Node {
  pack: PolicyPack;
  depth: number;
}

/**
 * Flattens the packs into render order, indenting each under the first parent it `extends`.
 *
 * A pack whose parent is missing sits at the root rather than disappearing — the loader would
 * have refused it, and a pack the operator cannot see is worse than one shown out of place.
 * Cycles cannot hang this: every pack is emitted exactly once, and `seen` is what guarantees it.
 */
function flatten(packs: PolicyPack[]): Node[] {
  const byName = new Map(packs.map((pack) => [pack.id, pack]));
  const children = new Map<string, PolicyPack[]>();
  const roots: PolicyPack[] = [];

  for (const pack of packs) {
    const parent = (pack.extends ?? []).map(parentName).find((id) => byName.has(id) && id !== pack.id);
    if (parent) children.set(parent, [...(children.get(parent) ?? []), pack]);
    else roots.push(pack);
  }

  const out: Node[] = [];
  const seen = new Set<string>();
  const emit = (pack: PolicyPack, depth: number) => {
    if (seen.has(pack.id)) return;
    seen.add(pack.id);
    out.push({ pack, depth });
    for (const child of children.get(pack.id) ?? []) emit(child, depth + 1);
  };
  for (const root of roots) emit(root, 0);
  // Anything a cycle kept out of the walk still belongs on screen.
  for (const pack of packs) emit(pack, 0);
  return out;
}

export interface PackTreeProps {
  packs: PolicyPack[];
  /** Policies each pack contributes, keyed by pack id. The control plane reports no count. */
  counts: Record<string, number>;
  selected: string | null;
  onSelect: (name: string) => void;
  onToggle: (pack: PolicyPack, enabled: boolean) => void;
  /** Pack whose toggle is mid-flight; its switch is inert until the request settles. */
  busy?: string | null;
}

export function PackTree({ packs, counts, selected, onSelect, onToggle, busy }: PackTreeProps) {
  const t = useTranslations("policies");
  const nodes = useMemo(() => flatten(packs), [packs]);

  return (
    <section aria-labelledby="pack-tree-title" className="flex flex-col gap-4">
      <h2 id="pack-tree-title" className="text-body-text-b3-md text-grayscale-300">
        {t("packs.title")}
      </h2>
      <ul className="flex flex-col gap-1">
        {nodes.map(({ pack, depth }) => (
          <li key={pack.id}>
            <div
              className={cn(
                "flex items-center gap-3 rounded-lg py-2 pr-3",
                selected === pack.id && "bg-grayscale-800"
              )}
              // The tree's nesting is the only thing depth changes, so it stays inline rather
              // than becoming a class per level.
              style={{ paddingLeft: `${12 + depth * 16}px` }}
            >
              <Switch
                checked={pack.enabled}
                disabled={busy === pack.id}
                onChange={(next) => onToggle(pack, next)}
                label={t("packs.toggle", { name: pack.id })}
              />
              <button
                type="button"
                onClick={() => onSelect(pack.id)}
                aria-current={selected === pack.id}
                title={pack.id}
                className={cn(
                  // Two lines then an ellipsis, as the design clamps `developer-relaxed`.
                  "line-clamp-2 min-w-0 flex-1 cursor-pointer text-left break-all",
                  // The design steps the type ramp down with depth: a root pack is 16px bold,
                  // everything it parents is 14px regular.
                  depth === 0 ? "text-body-mono-b2-bd" : "text-body-mono-b3-rg",
                  pack.enabled ? "text-grayscale-white" : "text-grayscale-500"
                )}
              >
                {pack.id}
              </button>
              <span className="text-caption-text-c-rg flex-none text-grayscale-400 tabular-nums">
                {counts[pack.id] ?? 0}
              </span>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
