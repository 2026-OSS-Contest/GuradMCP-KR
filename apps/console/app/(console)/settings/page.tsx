import { getTranslations } from "next-intl/server";
import { ScreenStub } from "@/components/screen-stub";

export default async function SettingsPage() {
  const t = await getTranslations();
  return <ScreenStub scr="SCR-501" title={t("screens.settings.title")} desc={t("screens.settings.desc")} note={t("common.scaffold")} />;
}
