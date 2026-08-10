import { ServerTrustSettings } from "@/components/settings/server-trust-settings";

/** SCR-501 Settings — server trust management (FR-GW-02 §6). Other settings sections (failure
 * policy, logging) remain a follow-up; §2.2 scopes this issue to server trust only. */
export default function SettingsPage() {
  return (
    <div data-scr="SCR-501" className="flex flex-1 flex-col gap-4 px-8 py-6">
      <ServerTrustSettings />
    </div>
  );
}
