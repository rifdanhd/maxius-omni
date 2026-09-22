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

export function AppSidebar() {
  const { collapsible, variant } = useLayout();
  const accessToken = useAuthStore((state) => state.auth.accessToken);
  const authUser = useAuthStore((state) => state.auth.user);
  const displayName = authUser?.accountNo ?? (accessToken ? "User" : "Masuk");
  const userEmail = authUser?.email ?? "";

  const user = {
    name: displayName,
    email: userEmail,
    avatar: "/avatars/default.png",
  };

  return (
    <Sidebar collapsible={collapsible} variant={variant}>
      <SidebarHeader>
        <TeamSwitcher teams={sidebarData.teams} />
      </SidebarHeader>
      <SidebarContent>
        {sidebarData.navGroups.map((props) => (
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
