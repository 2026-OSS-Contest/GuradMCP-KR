import { getTranslations } from "next-intl/server";
import { ScreenStub } from "@/components/screen-stub";

export default async function PolicyDetailPage({ params }: { params: Promise<{ policyId: string }> }) {
  const { policyId } = await params;
  const t = await getTranslations();
  return (
    <ScreenStub
      scr="SCR-302"
      title={t("screens.policies.title")}
      desc={`${t("screens.policies.desc")} · ${policyId}`}
      note={t("common.scaffold")}
    />
  );
}
