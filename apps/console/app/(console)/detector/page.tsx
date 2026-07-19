import { getTranslations } from "next-intl/server";
import { ScreenStub } from "@/components/screen-stub";

export default async function DetectorPage() {
  const t = await getTranslations();
  return <ScreenStub scr="SCR-401" title={t("screens.detector.title")} desc={t("screens.detector.desc")} note={t("common.scaffold")} />;
}
