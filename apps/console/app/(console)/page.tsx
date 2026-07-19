import { getTranslations } from "next-intl/server";
import { ScreenStub } from "@/components/screen-stub";

export default async function GatewayPage() {
  const t = await getTranslations();
  return <ScreenStub scr="SCR-101" title={t("screens.gateway.title")} desc={t("screens.gateway.desc")} note={t("common.scaffold")} />;
}
