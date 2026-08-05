// SCR-501 Settings fixtures (spec §5.7).
//
// Nothing here has a control-plane counterpart: `GET/PUT /settings` and `PUT /servers/{id}` are
// GMCP-80's, so the mock is the whole server. The defaults are the ones the design draws — the
// gateway ships fail-closed, raw storage off, Korean, and a 120s approval window.

import type { GatewaySettings, TrustLevel } from "@/lib/api/types";
import { SERVERS } from "./data";

const DEFAULTS: GatewaySettings = {
  failMode: "fail_closed",
  storeRawOptIn: false,
  locale: "ko",
  approvalTimeoutSeconds: 120
};

/** The window the approval console counts down; the design offers these and nothing between. */
export const APPROVAL_TIMEOUTS = [60, 120, 300] as const;

let settings: GatewaySettings = { ...DEFAULTS };
/** Trust changes are applied to a copy, so a reload does not carry them into the next test. */
let trust = new Map<string, TrustLevel>();

export function resetSettings(): void {
  settings = { ...DEFAULTS };
  trust = new Map();
}

export const currentSettings = (): GatewaySettings => settings;

export function patchSettings(update: Partial<GatewaySettings>): GatewaySettings {
  settings = { ...settings, ...update };
  return settings;
}

/** Servers with whatever trust tier has been set on top of the seeded one. */
export function currentServers() {
  return SERVERS.map((server) => ({ ...server, trust: trust.get(server.id) ?? server.trust }));
}

export function setTrust(id: string, level: TrustLevel) {
  const server = SERVERS.find((entry) => entry.id === id);
  if (!server) return undefined;
  trust.set(id, level);
  return { ...server, trust: level };
}
