import { ReplayScreen } from "@/components/replay/replay-screen";

/** Deep-linked replay: /replay/{sessionId}?event={eventId} (spec §3). */
export default async function ReplaySessionPage({
  params,
  searchParams
}: {
  params: Promise<{ sessionId: string }>;
  searchParams: Promise<{ event?: string }>;
}) {
  const { sessionId } = await params;
  const { event } = await searchParams;
  return <ReplayScreen sessionId={sessionId} eventId={event} />;
}
