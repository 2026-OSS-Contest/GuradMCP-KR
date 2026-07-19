import { getTranslations } from "next-intl/server";
import { ScreenStub } from "@/components/screen-stub";

export default async function ReplaySessionPage({ params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params;
  const t = await getTranslations();
  return (
    <ScreenStub
      scr="SCR-301"
      title={t("screens.replay.title")}
      desc={`${t("screens.replay.desc")} · ${sessionId}`}
      note={t("common.scaffold")}
    />
  );
}
