// SCR-501 Settings fixtures (spec §5.7).
//
// `GET/PUT /settings` has no control-plane counterpart — it is GMCP-80's — so the mock is the
// whole server for it. The defaults are the ones the design draws: the gateway ships fail-closed,
// raw storage off, Korean, and a 120s approval window.
//
// Server trust is *not* here. FR-GW-02 shipped `PUT /servers/{id}/trust` for real, and its mock
// lives beside the endpoint it mirrors in `handlers.ts`, writing back into `SERVERS` so the
// inventory and the change never disagree.

import type { GatewaySettings } from "@/lib/api/types";

const DEFAULTS: GatewaySettings = {
  failMode: "fail_closed",
  storeRawOptIn: false,
  locale: "ko",
  approvalTimeoutSeconds: 120
};

let settings: GatewaySettings = { ...DEFAULTS };

export const currentSettings = (): GatewaySettings => settings;

export function patchSettings(update: Partial<GatewaySettings>): GatewaySettings {
  settings = { ...settings, ...update };
  return settings;
}
