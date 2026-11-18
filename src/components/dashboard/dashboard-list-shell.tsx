"use client";

import type { ReactNode } from "react";
import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/dashboard/app-sidebar";
import { PhoneTopbar } from "@/components/shell/phone-topbar";
import { SHELL_CONTENT_ID, listNav } from "@/components/shell/sidebar-model";
import { SkipLink } from "@/components/uc/ui/skip-link";
import { SHELL_TEXT } from "@/lib/shell/text";

type User = {
  name?: string | null;
  email?: string | null;
  image?: string | null;
};

const NAV = listNav();

/**
 * La cornice di `/dashboard` (I tuoi workspace): la stessa barra laterale, con la sola voce «I tuoi workspace», e la
 * barra in alto del solo telefono (rilascio 10, PROPOSTA-10 §2.1). Un `SidebarProvider` suo, perché
 * `dashboard/[workspaceId]/layout` non annidi due contesti.
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
      <SkipLink targetId={SHELL_CONTENT_ID} label={SHELL_TEXT.skipToContent} />
      <AppSidebar nav={NAV} user={user} />
      <SidebarInset id={SHELL_CONTENT_ID} tabIndex={-1} className="outline-none">
        <PhoneTopbar nav={NAV} fallbackTitle={SHELL_TEXT.picker.title} />
        {children}
      </SidebarInset>
    </SidebarProvider>
  );
}
