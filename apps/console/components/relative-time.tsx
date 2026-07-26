"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

function label(t: (key: string, values?: Record<string, number>) => string, at: string, now: number): string {
  const seconds = Math.max(0, Math.round((now - Date.parse(at)) / 1000));
  if (seconds < 60) return t("justNow");
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return t("minutesAgo", { count: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t("hoursAgo", { count: hours });
  return t("daysAgo", { count: Math.floor(hours / 24) });
}

/** Ages the label in place so a tab left open does not keep claiming "방금 전". */
export function RelativeTime({ at, className }: { at: string; className?: string }) {
  const t = useTranslations("time");
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  return (
    <time dateTime={at} className={className}>
      {label(t, at, now)}
    </time>
  );
}
