"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Info } from "lucide-react";
import { decideApproval, getApprovals } from "@/lib/api/client";
import { ApiError } from "@/lib/api/client";
import type { Approval, ApprovalDecision } from "@/lib/api/types";
import { useResource } from "@/lib/api/use-resource";
import { createSseClient } from "@/lib/sse";
import { MOCK_API } from "@/mocks/scenario";
import { VerdictBadge } from "@/components/verdict-badge";
import { ApprovalCard } from "./approval-card";
import { ApprovalHistory } from "./approval-history";
import { cn } from "@/lib/utils";

/** Falls back to a poll: the queue must not go stale if the stream is quiet or unavailable. */
const POLL_MS = 5_000;
/** How long a timed-out card explains itself before the refetch drops it. */
const TIMEOUT_NOTICE_MS = 2_000;

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL;
const STREAM_URL = API_BASE ? `${API_BASE}/api/v1/events/stream` : MOCK_API ? "/api/v1/events/stream" : null;

type Tab = "queue" | "history";

/**
 * SCR-402 Approval Console (spec §5.6): the calls the gateway is holding, and what was decided.
 *
 * `GET /approvals` and `POST /approvals/{id}/decision` are served by the control plane today, so
 * this screen talks to a real gateway when one is configured.
 */
export function ApprovalConsole() {
  const t = useTranslations("approval");
  const [tab, setTab] = useState<Tab>("queue");
  const [busy, setBusy] = useState<string | null>(null);
  /** What the last decision attempt has to say for itself, if anything. */
  const [notice, setNotice] = useState<"conflict" | "decideFailed" | null>(null);
  /** Bumped by an approval event so the queue refetches the moment the gateway says so. */
  const [pulse, setPulse] = useState(0);

  // One unfiltered request: the API has no bucket covering the four terminal statuses, and both
  // tabs are views of the same list anyway.
  const approvals = useResource((signal) => getApprovals(signal), {
    intervalMs: POLL_MS,
    key: `approvals-${pulse}`
  });

  // The stream is the live path; the interval above is what keeps this honest when it is quiet.
  useEffect(() => {
    if (!STREAM_URL) return;
    const client = createSseClient({
      url: STREAM_URL,
      onMessage: (message) => {
        if (message.type === "approval.created" || message.type === "approval.resolved") {
          setPulse((previous) => previous + 1);
        }
      }
    });
    return () => client.close();
  }, []);

  // Memoised so the keyboard handler below re-subscribes when the queue actually changes, not on
  // every one-second expiry tick.
  const held = useMemo(() => approvals.data ?? [], [approvals.data]);
  const pending = useMemo(() => held.filter((approval) => approval.status === "pending"), [held]);
  const resolved = useMemo(() => held.filter((approval) => approval.status !== "pending"), [held]);

  // Read at keypress time rather than captured, so an expiry between renders still counts.
  const pendingRef = useRef(pending);
  pendingRef.current = pending;

  const decide = useCallback(
    async (approval: Approval, decision: ApprovalDecision) => {
      if (busy) return;
      setBusy(approval.id);
      setNotice(null);
      try {
        await decideApproval(approval.id, decision);
      } catch (error) {
        // 409: another operator, or the 120s timeout, resolved it first. Nothing to retry — the
        // refetch below replaces the card with whatever actually happened. Anything else is the
        // decision not landing at all, which the operator has to be told about: staying silent
        // reads as success while the call is still held.
        setNotice(error instanceof ApiError && error.status === 409 ? "conflict" : "decideFailed");
      } finally {
        setBusy(null);
        setPulse((previous) => previous + 1);
      }
    },
    [busy]
  );

  // Spec §5.6: B / M / A resolve the call at the top of the queue without reaching for the mouse.
  useEffect(() => {
    if (tab !== "queue") return;
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || event.metaKey || event.ctrlKey) return;
      const decision =
        event.key.toLowerCase() === "a" ? "approve" : event.key.toLowerCase() === "b" ? "block" : event.key.toLowerCase() === "m" ? "approve_masked" : undefined;
      if (!decision) return;
      // Skip anything already past its deadline: the gateway has blocked it server-side, so a
      // shortcut aimed at the card on top would otherwise spend itself on a 409.
      const top = pendingRef.current.find((approval) => Date.parse(approval.expiresAt) > Date.now());
      if (!top) return;
      event.preventDefault();
      void decide(top, decision);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [tab, decide]);

  // Expiry is decided here rather than inside the card, so this has to re-render on its own
  // clock; without it a deadline passing goes unnoticed until the next poll happens to land.
  const [, tick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => tick((previous) => previous + 1), 1_000);
    return () => clearInterval(timer);
  }, []);

  // A card past its deadline is already blocked server-side; it says so briefly, then a refetch
  // moves it into the history where it now belongs.
  useEffect(() => {
    if (!pending.some((approval) => Date.parse(approval.expiresAt) <= Date.now())) return;
    const timer = setTimeout(() => setPulse((previous) => previous + 1), TIMEOUT_NOTICE_MS);
    return () => clearTimeout(timer);
  }, [pending]);

  return (
    <div data-scr="SCR-402" className="flex min-h-0 flex-1 flex-col gap-4 px-8 py-6">
      <div className="flex flex-none items-center gap-6">
        {(["queue", "history"] as const).map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => setTab(value)}
            aria-current={tab === value ? "page" : undefined}
            className={cn(
              "flex items-center gap-2 border-b-2 pb-2 text-body-text-b2-bd transition-colors",
              tab === value ? "border-grayscale-white text-grayscale-white" : "border-transparent text-grayscale-400 hover:text-grayscale-200"
            )}
          >
            {t(value)}
            {value === "queue" && pending.length > 0 && (
              <span className="flex-none rounded-full bg-(--primitive-opacity-white-alpha-10) px-2 text-caption-text-c-rg">
                {pending.length}
              </span>
            )}
          </button>
        ))}

        {notice && (
          <p
            role="status"
            className="ml-auto flex items-center gap-2 rounded-lg bg-grayscale-700 px-4 py-3 text-body-text-b3-md text-grayscale-white"
          >
            <Info className="size-4 flex-none" aria-hidden />
            {t(notice)}
          </p>
        )}
      </div>

      {tab === "queue" ? (
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto">
          {approvals.error && !approvals.data ? (
            <p role="status" className="py-16 text-center text-body-text-b3-md text-grayscale-400">
              {t("error")}
            </p>
          ) : pending.length === 0 ? (
            <p role="status" className="py-16 text-center text-title-text-t2-bd text-grayscale-400">
              {t("queueEmpty")}
            </p>
          ) : (
            pending.map((approval) =>
              Date.parse(approval.expiresAt) <= Date.now() ? (
                <TimedOut key={approval.id} approval={approval} />
              ) : (
                <ApprovalCard
                  key={approval.id}
                  approval={approval}
                  busy={busy === approval.id}
                  onDecide={(decision) => void decide(approval, decision)}
                />
              )
            )
          )}
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <ApprovalHistory approvals={resolved} />
        </div>
      )}
    </div>
  );
}

/** The transition the design draws when the gateway fails a held call closed. */
function TimedOut({ approval }: { approval: Approval }) {
  const t = useTranslations("approval");
  return (
    <p
      role="status"
      className="flex flex-wrap items-center gap-3 rounded-2xl border border-dashed border-(--primitive-opacity-block-alpha-10) px-6 py-4"
    >
      <VerdictBadge verdict="block" size="sm" />
      <span className="font-mono text-body-mono-b2-rg text-grayscale-white">{approval.toolName}</span>
      <span className="text-caption-text-c-rg text-grayscale-400">· {t("timedOut")}</span>
      <span className="ml-auto text-caption-text-c-rg text-grayscale-400">{t("movingToHistory")}</span>
    </p>
  );
}
