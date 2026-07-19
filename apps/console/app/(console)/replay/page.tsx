import { getTranslations } from "next-intl/server";
import { ScreenStub } from "@/components/screen-stub";

export default async function ReplayPage() {
  const t = await getTranslations();
  return <ScreenStub scr="SCR-301" title={t("screens.replay.title")} desc={t("screens.replay.desc")} note={t("common.scaffold")} />;
}
