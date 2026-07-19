import { getTranslations } from "next-intl/server";
import { ScreenStub } from "@/components/screen-stub";

export default async function DemoPage() {
  const t = await getTranslations();
  return <ScreenStub scr="SCR-201" title={t("screens.liveConsole.title")} desc={t("screens.liveConsole.desc")} note={t("common.scaffold")} />;
}
