import { ReplayScreen } from "@/components/replay/replay-screen";

/** SCR-301 Replay — FR-RPL-01/02, UI specification §5.3. */
export default async function ReplayPage({ searchParams }: { searchParams: Promise<{ event?: string }> }) {
  const { event } = await searchParams;
  return <ReplayScreen eventId={event} />;
}
