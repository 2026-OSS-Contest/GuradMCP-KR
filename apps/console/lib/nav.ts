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

export type NavKey = "gateway" | "liveConsole" | "replay" | "detector" | "approval" | "policies" | "settings";

export type NavIconComponent = ComponentType<SVGProps<SVGSVGElement>>;

export interface NavItem {
  key: NavKey;
  href: string;
  scr: string;
  icon: NavIconComponent;
}

/** Rail nav order per UI spec §4.1 (SCR-000). Icons extracted from the Figma nav. */
export const navItems: NavItem[] = [
  { key: "gateway", href: "/", scr: "SCR-101", icon: GatewayIcon },
  { key: "liveConsole", href: "/demo", scr: "SCR-201", icon: LiveConsoleIcon },
  { key: "replay", href: "/replay", scr: "SCR-301", icon: ReplayIcon },
  { key: "detector", href: "/detector", scr: "SCR-401", icon: DetectorIcon },
  { key: "approval", href: "/approvals", scr: "SCR-402", icon: ApprovalIcon },
  { key: "policies", href: "/policies", scr: "SCR-302", icon: PoliciesIcon },
  { key: "settings", href: "/settings", scr: "SCR-501", icon: SettingsIcon }
];
