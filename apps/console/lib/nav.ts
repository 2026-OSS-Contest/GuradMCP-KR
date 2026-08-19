import type { ComponentType, SVGProps } from "react";
import {
  GatewayIcon,
  LiveConsoleIcon,
  ReplayIcon,
  DetectorIcon,
  ApprovalIcon,
  PoliciesIcon,
  SettingsIcon
} from "@/components/shell/nav-icons";
import { RiskHighIcon } from "@/components/icons";

export type NavKey =
  | "gateway"
  | "liveConsole"
  | "replay"
  | "detector"
  | "approval"
  | "policies"
  | "benchmark"
  | "settings";

export type NavIconComponent = ComponentType<SVGProps<SVGSVGElement>>;

export interface NavItem {
  key: NavKey;
  href: string;
  scr: string;
  icon: NavIconComponent;
}

/**
 * Rail nav order per UI spec §4.1 (SCR-000). Icons extracted from the Figma nav.
 *
 * Benchmark is the one entry §4.1 does not list — SCR-601 came after it (GMCP-61), and it sits
 * before Setting because Setting is where a rail ends. Its icon is the inventory's own risk bars
 * rather than a new glyph: the same reading, a measurement.
 */
export const navItems: NavItem[] = [
  { key: "gateway", href: "/", scr: "SCR-101", icon: GatewayIcon },
  { key: "liveConsole", href: "/demo", scr: "SCR-201", icon: LiveConsoleIcon },
  { key: "replay", href: "/replay", scr: "SCR-301", icon: ReplayIcon },
  { key: "detector", href: "/detector", scr: "SCR-401", icon: DetectorIcon },
  { key: "approval", href: "/approvals", scr: "SCR-402", icon: ApprovalIcon },
  { key: "policies", href: "/policies", scr: "SCR-302", icon: PoliciesIcon },
  { key: "benchmark", href: "/benchmark", scr: "SCR-601", icon: RiskHighIcon },
  { key: "settings", href: "/settings", scr: "SCR-501", icon: SettingsIcon }
];
