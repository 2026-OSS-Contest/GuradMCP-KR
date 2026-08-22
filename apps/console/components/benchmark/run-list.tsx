"use client";

import { useEffect, useRef } from "react";
import { useTranslations } from "next-intl";
import { RowFailIcon, RowPassIcon, RowPendingIcon } from "./icons";
import type { RunRow, RunState } from "./use-benchmark-run";
import { cn } from "@/lib/utils";

/**
 * What is being measured, one row at a time (`scr-601-*` frames).
 *
 * The point of showing every sample rather than a count is that the numbers on the right are
 * otherwise unfalsifiable: 176 texts, 40 attack probes and 29 policy fixtures scroll past with
 * their verdicts, and the reader can stop on any one of them — and open it. A long case text
 * ellipsizes rather than scrolling the list sideways; the dialog carries it whole.
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

  // Rows grouped into their sections, so each section renders as a band followed by its rows.
  const groups: { section: RunRow["section"]; items: { row: RunRow; index: number }[] }[] = [];
  for (const [index, row] of rows.entries()) {
    const open = groups.at(-1);
    if (open && open.section === row.section) open.items.push({ row, index });
    else groups.push({ section: row.section, items: [{ row, index }] });
  }

  return (
    // Deliberately not a live region. 245 rows land in about three seconds, and `role="log"`
    // (implicit `aria-live="polite"`) would queue every one of them for reading. The result
    // panel announces the outcome once instead.
    <div data-testid="run-list" className="flex min-h-0 flex-1 flex-col overflow-y-auto p-3">
      <ul className="flex w-full flex-col gap-1">
        {groups.map((group) => (
          <li key={group.section} className="flex flex-col gap-1">
            {/* Section band (`Run List` header instance): a 6% pill that scrolls with its
                rows — it marks where a section starts rather than following the reader down. */}
            <h3 className="flex w-full items-center gap-2 rounded-(--primitive-radius-rounded-xl) bg-(--primitive-opacity-white-alpha-6) px-3 py-2">
              <span className="flex-none text-body-text-b2-md text-grayscale-white">{t(`section.${group.section}`)}</span>
              <span className="min-w-0 flex-1 text-body-text-b2-md text-(--primitive-opacity-white-alpha-75)">
                {group.items.length}
              </span>
            </h3>
            <ul className="flex flex-col">
              {group.items.map(({ row, index }) => {
                const done = index < checked;
                // The row the run is on — the pointer moving down the list, and the row the
                // list keeps scrolled into view, so the two agree.
                const current = index === checked - 1;
                return (
                  <li key={row.id} ref={current ? cursor : undefined}>
                    <button
                      type="button"
                      onClick={() => onSelect(row)}
                      className={cn(
                        // The frame rules each row along its bottom edge — and draws it as an
                        // inset shadow, not a border, so the line costs the row no height and
                        // 245 of them do not push the list a quarter-screen longer.
                        "flex w-full items-center gap-3 px-3 py-2 text-left shadow-[inset_0_-1px_0_0_var(--primitive-opacity-white-alpha-10)] hover:bg-(--primitive-opacity-white-alpha-6)",
                        current && state === "running" && "bg-(--primitive-opacity-white-alpha-6)"
                      )}
                    >
                      {/* CaseID group (`Run List/CaseID`, 100px): the status mark rides with
                          the id, not in a column of its own. Hollow circle → check → block. */}
                      <span className="flex w-25 flex-none items-center gap-1">
                        <span className="flex size-4 flex-none items-center justify-center">
                          {done ? (
                            row.passed ? (
                              <RowPassIcon className="size-4" aria-hidden />
                            ) : (
                              <RowFailIcon className="size-4" aria-hidden />
                            )
                          ) : (
                            <RowPendingIcon className="size-4" aria-hidden />
                          )}
                        </span>
                        <span title={row.id} className="min-w-0 flex-1 truncate font-mono text-body-mono-b3-rg text-grayscale-white">
                          {row.id}
                        </span>
                      </span>
                      {row.kind !== null && (
                        <span className="flex-none rounded-(--primitive-radius-rounded-sm) bg-(--primitive-opacity-white-alpha-10) px-2 py-px font-mono text-caption-mono-c-rg text-green-200 shadow-[inset_0_0_0_1px_var(--primitive-opacity-white-alpha-10)]">
                          {row.kind}
                        </span>
                      )}
                      <span
                        title={row.text}
                        className="min-w-0 flex-1 truncate text-caption-text-c-md text-(--primitive-opacity-white-alpha-75)"
                      >
                        {row.text}
                      </span>
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
