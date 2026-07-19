import { getTranslations } from "next-intl/server";
import { ScreenStub } from "@/components/screen-stub";

export default async function ApprovalsPage() {
  const t = await getTranslations();
  return <ScreenStub scr="SCR-402" title={t("screens.approval.title")} desc={t("screens.approval.desc")} note={t("common.scaffold")} />;
}
