"use client";

import { useEffect, useState } from "react";
import { FlaskConical, X } from "lucide-react";
import { RESOURCE_REFRESH_EVENT } from "@/lib/api/use-resource";
import { cn } from "@/lib/utils";
import { SCENARIOS, SHOW_SCENARIO_SWITCHER, readScenario, writeScenario, type ScenarioId } from "@/mocks/scenario";

/** Labels stay untranslated — this panel only ever renders for developers. */
const LABELS: Record<ScenarioId, { title: string; hint: string }> = {
  full: { title: "정상", hint: "서버 3대 · 이벤트 6건" },
  empty: { title: "빈 상태", hint: "등록된 서버 없음 → Quick Start" },
  offline: { title: "미연결", hint: "API 응답 실패 → 전역 배너" }
};

export function ScenarioSwitcher() {
  const [open, setOpen] = useState(false);
  const [scenario, setScenario] = useState<ScenarioId>("full");

  // localStorage is unavailable while rendering, so adopt the stored value after mount.
  useEffect(() => setScenario(readScenario()), []);

  if (!SHOW_SCENARIO_SWITCHER) return null;

  const select = (id: ScenarioId) => {
    writeScenario(id);
    setScenario(id);
    window.dispatchEvent(new Event(RESOURCE_REFRESH_EVENT));
  };

  return (
    <div className="fixed right-4 bottom-4 z-50 flex flex-col items-end gap-2">
      {open && (
        <div className="w-72 rounded-lg border border-grayscale-700 bg-grayscale-900 p-3 shadow-xl">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-semibold text-grayscale-300">Mock API 상태</span>
            <button type="button" onClick={() => setOpen(false)} aria-label="닫기" className="text-grayscale-400 hover:text-foreground">
              <X className="size-4" />
            </button>
          </div>
          <div className="flex flex-col gap-1">
            {SCENARIOS.map((id) => (
              <button
                key={id}
                type="button"
                onClick={() => select(id)}
                aria-pressed={scenario === id}
                className={cn(
                  "flex flex-col rounded-md px-2 py-1.5 text-left transition-colors hover:bg-white/5",
                  scenario === id && "bg-(--primitive-opacity-blue-alpha-50)"
                )}
              >
                <span className="text-sm">{LABELS[id].title}</span>
                <span className="text-xs text-grayscale-400">{LABELS[id].hint}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <button
        type="button"
        onClick={() => setOpen((previous) => !previous)}
        aria-label="Mock API 상태 전환"
        className="flex size-10 items-center justify-center rounded-full border border-grayscale-700 bg-grayscale-900 text-grayscale-300 shadow-lg transition-colors hover:text-foreground"
      >
        <FlaskConical className="size-5" />
      </button>
    </div>
  );
}
