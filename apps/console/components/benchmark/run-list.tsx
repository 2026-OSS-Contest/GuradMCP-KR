"use client";

import { useEffect, useRef } from "react";
import { useTranslations } from "next-intl";
import { CheckMarkIcon, VerdictBlockIcon } from "@/components/icons";
import type { RunRow, RunState } from "./use-benchmark-run";

/**
 * What is being measured, one row at a time.
 *
 * The point of showing every sample rather than a count is that the numbers on the right are
 * otherwise unfalsifiable: 176 texts, 40 attack probes and 29 policy fixtures scroll past with
 * their verdicts, and the reader can stop on any one of them — and open it.
 *
 * Nothing is elided. Rows do not wrap and the list scrolls sideways, so a short sample reads
 * whole and a long one is one drag away rather than cut off at a fixed column.
 */
export function RunList({
  rows,
  checked,
  state,
  onSelect
}: {
  rows: RunRow[];
  checked: number;
  state: RunState;
  onSelect: (row: RunRow) => void;
}) {
  const t = useTranslations("benchmark");
  const cursor = useRef<HTMLLIElement>(null);

  // Follow the checks down. Only while running: once it is done the reader takes over, and a
  // scroll that keeps yanking back to the end is worse than none.
  useEffect(() => {
    if (state !== "running") return;
    cursor.current?.scrollIntoView({ block: "nearest" });
  }, [checked, state]);

  // A sticky element can only travel inside its own containing block, so a heading that sits in
  // the same element as one row follows the scroll for that row's height and then leaves. The
  // rows are grouped into their sections here, which makes each heading's block the section it
  // names — and it stays put until the next one pushes it off.
  const groups: { section: RunRow["section"]; items: { row: RunRow; index: number }[] }[] = [];
  for (const [index, row] of rows.entries()) {
    const open = groups.at(-1);
    if (open && open.section === row.section) open.items.push({ row, index });
    else groups.push({ section: row.section, items: [{ row, index }] });
  }

  return (
    // `-mx-2 px-2`: see session-list — without it the scroll container clips the focus ring.
    // No padding at the top, though: see the heading below.
    //
    // Deliberately not a live region. 245 rows land in about three seconds, and `role="log"`
    // (which carries an implicit `aria-live="polite"`) would queue every one of them for reading.
    // The result panel announces the outcome once instead.
    <div data-testid="run-list" className="-mx-2 -mb-2 flex min-h-0 flex-1 flex-col overflow-auto px-2 pb-2">
      <ul className="flex w-max min-w-full flex-col">
        {groups.map((group) => (
          <li key={group.section} className="flex flex-col">
            {/* The heading is what separates the groups, so it carries a ground of its own, one
                step lighter than the panel. It has to be opaque in any case: it spans the scroll
                width and the rows pass behind it, with the label inside pinned left so the group
                stays named while the reader scrolls sideways through a long probe.

                The scroll container carries no padding at the top: content scrolls through a
                scroll container's padding, so a band stuck at `top-0` would leave those 8px
                showing above it with rows sliding past in the gap. */}
            <h3 className="sticky top-0 z-10 mt-4 mb-1 w-full border-y border-(--primitive-opacity-white-alpha-10) bg-grayscale-800 px-2 py-1.5 text-body-text-b3-md text-grayscale-200 first:mt-0">
              <span className="sticky left-0 inline-block">
                {t(`section.${group.section}`)}{" "}
                {/* grayscale-400 rather than white-alpha-50: on the band's lighter ground the
                    alpha lands at 4.48:1, just under the mark. */}
                <span className="text-grayscale-400">{group.items.length}</span>
              </span>
            </h3>
            <ul className="flex flex-col">
              {group.items.map(({ row, index }) => {
                const done = index < checked;
                return (
                  <li key={row.id} ref={index === checked - 1 ? cursor : undefined}>
                    <button
                      type="button"
                      onClick={() => onSelect(row)}
                      className="flex w-full items-center gap-3 rounded-sm py-1 text-left whitespace-nowrap hover:bg-(--primitive-opacity-white-alpha-6)"
                    >
                      {/* The verdict mark alone says whether a row has been reached. Dimming the
                          row itself was the first draft, and it put every unreached sample under
                          4.5:1 — on a screen whose whole point is that they can be read (NFR-08).

                          The tick is white, not green: on a run that passes it is 245 marks, and
                          245 green marks leave a single red one nowhere to stand out. The green
                          is spent once, on the gate card that lands when the cascade finishes. */}
                      <span className="flex size-5 flex-none items-center justify-center">
                        {done ? (
                          row.passed ? (
                            <CheckMarkIcon className="text-grayscale-white" aria-hidden />
                          ) : (
                            <VerdictBlockIcon className="h-5 w-4 text-verdict-block" aria-hidden />
                          )
                        ) : (
                          <span className="size-2 rounded-full bg-(--primitive-opacity-white-alpha-25)" aria-hidden />
                        )}
                      </span>
                      {/* One gutter width for every section, so the rows read as columns. The
                          short ids (`p01`, `T-01-a`) fit it; a fixture id — a whole case name —
                          is the one thing here that is elided, and the dialog has it whole. */}
                      <span
                        title={row.id}
                        className="w-24 flex-none truncate font-mono text-caption-mono-c-rg text-(--primitive-opacity-white-alpha-50)"
                      >
                        {row.id}
                      </span>
                      {row.kind && (
                        <span className="flex-none rounded-sm bg-(--primitive-opacity-white-alpha-10) px-2 py-px font-mono text-caption-mono-c-rg text-grayscale-200 shadow-[inset_0_0_0_1px_var(--primitive-opacity-white-alpha-10)]">
                          {row.kind}
                        </span>
                      )}
                      <span className="flex-none pr-2 text-body-text-b3-md text-grayscale-300">{row.text}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </li>
        ))}
      </ul>
    </div>
  );
}
