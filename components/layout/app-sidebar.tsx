"use client";

import { useState, useEffect } from "react";
import { useAuthStore } from "@/stores/auth-store";
import { useLayout } from "@/context/layout-provider";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarRail,
} from "@/components/ui/sidebar";
import { AppTitle } from "./app-title";
import { NavGroup } from "./nav-group";
import { NavUser } from "./nav-user";
import { TeamSwitcher } from "./team-switcher";
import { sidebarData } from "./data/sidebar-data";
import { authFetch } from "@/lib/utils/api-client";
import type { NavItem } from "./types";

type Summary = { readyToShip: number; criticalStock: number; oversell: number };
type Kpi = { mismatch?: { total?: number } };

function formatBadge(value: number | undefined) {
  if (!value || value < 1) return undefined;
  return value > 99 ? "99+" : String(value);
}

export function AppSidebar() {
  const { collapsible, variant } = useLayout();
  const authenticated = useAuthStore((state) => state.auth.authenticated);
  const authUser = useAuthStore((state) => state.auth.user);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [kpi, setKpi] = useState<Kpi | null>(null);
  const displayName = authUser?.accountNo ?? (authenticated ? "User" : "Masuk");
  const userEmail = authUser?.email ?? "";

  const user = {
    name: displayName,
    email: userEmail,
    avatar: "/avatars/default.png",
  };

  useEffect(() => {
    if (!authenticated) return;
    let cancelled = false;
    Promise.all([
      authFetch("/api/summary").then((response) => response.ok ? response.json() as Promise<Summary> : null),
      authFetch("/api/dashboard/kpi").then((response) => response.ok ? response.json() as Promise<Kpi> : null),
    ]).then(([nextSummary, nextKpi]) => {
      if (cancelled) return;
      setSummary(nextSummary);
      setKpi(nextKpi);
    }).catch(() => {
      if (!cancelled) {
        setSummary(null);
        setKpi(null);
      }
    });
    return () => { cancelled = true; };
  }, [authenticated]);

  const withBadge = (item: NavItem): NavItem => {
    const badge = item.title === "Pesanan"
      ? formatBadge(summary?.readyToShip)
      : item.title === "Inventori"
        ? formatBadge((summary?.criticalStock ?? 0) + (summary?.oversell ?? 0))
        : item.title === "Kelola Pesanan"
          ? formatBadge(summary?.readyToShip)
          : item.title === "Stok Mismatch"
            ? formatBadge(kpi?.mismatch?.total)
            : item.badge;
    if (!item.items) return { ...item, badge };
    const items = item.items.map((child) => ({
      ...child,
      badge: child.title === "Kelola Pesanan"
        ? formatBadge(summary?.readyToShip)
        : child.title === "Stok Mismatch"
          ? formatBadge(kpi?.mismatch?.total)
          : child.badge,
    }));
    return { ...item, badge, items };
  };
  const navGroups = sidebarData.navGroups.map((group) => ({
    ...group,
    items: group.items.map(withBadge),
  }));

  return (
    <Sidebar collapsible={collapsible} variant={variant}>
      <SidebarHeader>
        <TeamSwitcher teams={sidebarData.teams} />
      </SidebarHeader>
      <SidebarContent>
        {navGroups.map((props) => (
          <NavGroup key={props.title} {...props} />
        ))}
      </SidebarContent>
      <SidebarFooter>
        <NavUser user={user} />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
