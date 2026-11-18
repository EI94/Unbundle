"use client";

import { Suspense, type ReactNode } from "react";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/dashboard/app-sidebar";
import { SkipLink } from "@/components/uc/ui/skip-link";
import { AccountSheet } from "./account-sheet";
import { PhoneTopbar } from "./phone-topbar";
import { SHELL_CONTENT_ID, type ShellNav } from "./sidebar-model";
import { SHELL_TEXT } from "@/lib/shell/text";

/**
 * La cornice di un workspace (rilascio 10, ondata 2a, PROPOSTA-10 §2.1, §3.1): «Salta al contenuto», la barra
 * laterale, il riquadro della pagina con la barra in alto del solo telefono, e il foglio «Il tuo account» (`?account=`).
 * Su desktop non c'è una barra in alto: la pagina comincia subito.
 */
export function WorkspaceShell({
  nav,
  workspaceId,
  workspaceName,
  user,
  bell,
  accountData = true,
  children,
}: {
  nav: ShellNav;
  workspaceId: string;
  workspaceName: string;
  user: { name?: string | null; email?: string | null; image?: string | null };
  /** La campanella dal server (`WorkspaceBell`); null per chi segue solo un corso. */
  bell?: ReactNode;
  /** Il foglio legge preferenze e accessi (no per chi segue solo un corso, che vi trova il tema). */
  accountData?: boolean;
  children: ReactNode;
}) {
  return (
    <SidebarProvider>
      <SkipLink targetId={SHELL_CONTENT_ID} label={SHELL_TEXT.skipToContent} />
      <AppSidebar nav={nav} workspaceId={workspaceId} workspaceName={workspaceName} user={user} bell={bell} />
      <SidebarInset id={SHELL_CONTENT_ID} tabIndex={-1} className="outline-none">
        <PhoneTopbar nav={nav} workspaceId={workspaceId} fallbackTitle={workspaceName} bell={bell} />
        {children}
      </SidebarInset>
      {/* `useSearchParams` del foglio dentro un Suspense: la pagina non aspetta il foglio. */}
      <Suspense fallback={null}>
        <AccountSheet workspaceId={workspaceId} user={user} loadData={accountData} />
      </Suspense>
    </SidebarProvider>
  );
}
