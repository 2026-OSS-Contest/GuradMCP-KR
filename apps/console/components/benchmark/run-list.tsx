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
 * their verdicts, and the reader can stop on any one of them — and open it.
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

  // A sticky heading can only travel inside its own containing block, so the rows are grouped
  // into their sections — each heading's block is the section it names, and it stays put until
  // the next one pushes it off.
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
    //
    // The frame pads the list 12px on every side; the top 12 are a spacer that scrolls away
    // rather than padding, so the sticky heading can sit flush at `top-0` instead of letting
    // rows slide past above it.
    <div data-testid="run-list" className="flex min-h-0 flex-1 flex-col overflow-auto px-3 pb-3">
      <div className="h-3 w-full flex-none" aria-hidden />
      <ul className="flex w-max min-w-full flex-col gap-1">
        {groups.map((group) => (
          <li key={group.section} className="flex flex-col gap-1">
            {/* Section band (`Run List` header instance): 6% white on the card's 900, which is
                translucent — fine in the frame, but rows would show through it while it is
                stuck, so the ground is composited onto the card colour it would blend with
                anyway. The label stays pinned left for horizontal scrolling. */}
            <h3 className="sticky top-0 z-10 h-10 w-full rounded-(--primitive-radius-rounded-xl) px-3 py-2 [background:linear-gradient(var(--primitive-opacity-white-alpha-6),var(--primitive-opacity-white-alpha-6)),var(--primitive-color-grayscale-900)]">
              <span className="sticky left-3 inline-flex items-center gap-2">
                <span className="text-body-text-b2-md text-grayscale-white">{t(`section.${group.section}`)}</span>
                <span className="text-body-text-b2-md text-(--primitive-opacity-white-alpha-75)">
                  {group.items.length}
                </span>
              </span>
            </h3>
            <ul className="flex flex-col">
              {group.items.map(({ row, index }, at) => {
                const done = index < checked;
                // The row the run is on — the pointer moving down the list, and the row the
                // list keeps scrolled into view, so the two agree.
                const current = index === checked - 1;
                // The kind chip marks where a kind starts, not every row of it — the frame
                // chips p01/PHONE and leaves p02–p07 bare (base and 실행완료 exports alike).
                const kindStarts =
                  row.kind !== null && (at === 0 || group.items[at - 1].row.kind !== row.kind);
                return (
                  <li key={row.id} ref={current ? cursor : undefined}>
                    <button
                      type="button"
                      onClick={() => onSelect(row)}
                      className={cn(
                        "flex w-full items-center gap-3 rounded-(--primitive-radius-rounded-lg) px-3 py-2 text-left whitespace-nowrap hover:bg-(--primitive-opacity-white-alpha-6)",
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
                        <span title={row.id} className="truncate font-mono text-body-mono-b3-rg text-grayscale-white">
                          {row.id}
                        </span>
                      </span>
                      {kindStarts && (
                        <span className="flex-none rounded-(--primitive-radius-rounded-sm) bg-(--primitive-opacity-white-alpha-10) px-2 py-px font-mono text-caption-mono-c-rg text-green-200 shadow-[inset_0_0_0_1px_var(--primitive-opacity-white-alpha-10)]">
                          {row.kind}
                        </span>
                      )}
                      <span className="flex-none pr-2 text-caption-text-c-md text-(--primitive-opacity-white-alpha-75)">
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
