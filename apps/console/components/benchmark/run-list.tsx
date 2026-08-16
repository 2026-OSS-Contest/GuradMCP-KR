"use client";

import { useEffect, useRef } from "react";
import { useTranslations } from "next-intl";
import { VerdictAllowIcon, VerdictBlockIcon } from "@/components/icons";
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

  let section: RunRow["section"] | null = null;

  return (
    // `p-2 -m-2`: see session-list — without it the scroll container clips the focus ring.
    //
    // Deliberately not a live region. 245 rows land in about three seconds, and `role="log"`
    // (which carries an implicit `aria-live="polite"`) would queue every one of them for reading.
    // The result panel announces the outcome once instead.
    <div data-testid="run-list" className="-m-2 flex min-h-0 flex-1 flex-col overflow-auto p-2">
      <ul className="flex w-max min-w-full flex-col">
        {rows.map((row, index) => {
          const done = index < checked;
          const heading = row.section !== section ? row.section : null;
          const first = section === null;
          section = row.section;
          return (
            <li key={`${row.section}-${row.id}`} ref={index === checked - 1 ? cursor : undefined}>
              {/* A rule across the whole list between the groups, so the six read as six lists.
                  It is its own element rather than a border on the heading, which is only as
                  wide as its text. */}
              {heading && !first && <div className="my-2 h-px w-full bg-(--primitive-opacity-white-alpha-10)" />}
              {heading && (
                // Sticky on both axes: the group has to stay named while the reader scrolls
                // sideways through a long probe as well as down the list.
                <h3 className="sticky top-0 left-0 z-10 w-max bg-grayscale-900 py-2 text-body-text-b3-md text-grayscale-300">
                  {t(`section.${heading}`)}{" "}
                  <span className="text-(--primitive-opacity-white-alpha-50)">
                    {rows.filter((other) => other.section === heading).length}
                  </span>
                </h3>
              )}
              <button
                type="button"
                onClick={() => onSelect(row)}
                className="flex w-full items-center gap-3 rounded-sm py-1 text-left whitespace-nowrap hover:bg-(--primitive-opacity-white-alpha-6)"
              >
                {/* The verdict mark alone says whether a row has been reached. Dimming the row
                    itself was the first draft, and it put every unreached sample under 4.5:1 —
                    on a screen whose whole point is that the samples can be read (NFR-08). */}
                <span className="flex size-5 flex-none items-center justify-center">
                  {done ? (
                    row.passed ? (
                      <VerdictAllowIcon className="h-5 w-4 text-verdict-allow" aria-hidden />
                    ) : (
                      <VerdictBlockIcon className="h-5 w-4 text-verdict-block" aria-hidden />
                    )
                  ) : (
                    <span className="size-2 rounded-full bg-(--primitive-opacity-white-alpha-25)" aria-hidden />
                  )}
                </span>
                {/* Scenarios and fixtures are named by their id, so printing it here as well
                    would repeat the same string twice; the column stays for the alignment. */}
                <span className="w-24 flex-none font-mono text-caption-mono-c-rg text-(--primitive-opacity-white-alpha-50)">
                  {row.id === row.text ? "" : row.id}
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
    </div>
  );
}
