"use client";

import type { ReactNode } from "react";
import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/dashboard/app-sidebar";

type User = {
  name?: string | null;
  email?: string | null;
  image?: string | null;
};

/**
 * Shell sidebar solo per `/dashboard` (lista workspace). Evita doppio SidebarProvider
 * con `dashboard/[workspaceId]/layout` che altrimenti anniderebbe due contesti.
 */
export function DashboardListShell({
  user,
  children,
}: {
  user: User;
  children: ReactNode;
}) {
  return (
    <SidebarProvider>
      <AppSidebar user={user} />
      <SidebarInset>{children}</SidebarInset>
    </SidebarProvider>
  );
}
