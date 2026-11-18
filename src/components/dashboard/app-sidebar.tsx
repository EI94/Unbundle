"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { signOut } from "firebase/auth";
import { firebaseAuth } from "@/lib/firebase/client";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  useSidebar,
} from "@/components/ui/sidebar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { confirmLearningNavigation } from "@/components/learning/use-unsaved-changes";
import { endAppSession } from "@/lib/auth/end-session";
import { isNavItemActive } from "@/components/dashboard/nav-active";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ThemeMenuGroup } from "@/components/theme/theme-menu";
import { NAV_ICONS } from "@/components/shell/nav-icons";
import { WorkspaceSwitcher } from "@/components/shell/workspace-switcher";
import { BellSlot } from "@/components/shell/bell-slot";
import { navBase, type ShellNav, type ShellNavItem } from "@/components/shell/sidebar-model";
import { openAccountSheet } from "@/components/shell/account-url";
import { SHELL_TEXT } from "@/lib/shell/text";
import { ChevronUp, LogOut, Palette, UserRound } from "lucide-react";

const T = SHELL_TEXT;

/** Voci da 44 px nel foglio del telefono, 36 px da 768 px (PROPOSTA-10 §5.3, §9.0). */
const ITEM_CLASS = "h-11 gap-2.5 px-2.5 md:h-9";
/** Le voci del menu sotto il nome: 44 px al telefono. */
const MENU_ITEM_CLASS = "min-h-11 gap-2 sm:min-h-8";

interface AppSidebarProps {
  /** Le voci per chi guarda (`workspaceNav` nel layout del workspace, `listNav` su `/dashboard`). */
  nav: ShellNav;
  workspaceId?: string;
  workspaceName?: string;
  user: {
    name?: string | null;
    email?: string | null;
    image?: string | null;
  };
  /** La campanella dal server (`WorkspaceBell`): nella testata, accanto al selettore, su desktop. */
  bell?: ReactNode;
}

/**
 * La barra laterale (rilascio 10, ondata 2a «Cornice», docs/ui-10/PROPOSTA-10.md §2.1, §3.1, §9.0).
 *
 * - **Testata**: il nome del workspace è un selettore («Tutti i workspace», «Nuovo workspace»); accanto, la campanella
 *   (su desktop; al telefono sta nella barra in alto, `PhoneTopbar`). Fuori da un workspace, il marchio.
 * - **Voci**: le principali (`nav.main`), con le viste della voce accesa sotto di lei; poi una linea sottile e gli altri
 *   strumenti di oggi (`nav.tools`), senza titolo (D11 respinta). La voce resta accesa su tutte le sue pagine.
 * - **Piede**: «Impostazioni» per chi gestisce il workspace; il nome, con il menu «Il tuo account» · «Tema ›» · «Esci».
 *   Ogni voce del menu fa da sé la sua azione, con il mouse, il dito o Invio.
 */
export function AppSidebar({ nav, workspaceId, workspaceName, user, bell }: AppSidebarProps) {
  const { isMobile, setOpenMobile } = useSidebar();
  const closeMobileNavigation = () => {
    if (isMobile) setOpenMobile(false);
  };
  const pathname = usePathname() ?? "";
  const router = useRouter();
  const basePath = navBase(workspaceId);

  const handleLogout = async () => {
    if (!confirmLearningNavigation()) return;
    // La fine della sessione, la stessa di «Cambia account»: le board dell'activity mapping aperte mandano quello che
    // resta e le loro bozze lasciano il dispositivo, poi la sessione finisce.
    await endAppSession();
    await signOut(firebaseAuth).catch(() => {});
    closeMobileNavigation();
    router.push("/login");
  };

  const openAccount = () => {
    closeMobileNavigation();
    openAccountSheet();
  };

  const initials = user.name
    ? user.name.split(" ").map((n) => n[0]).join("").toUpperCase()
    : user.email?.[0]?.toUpperCase() ?? "U";

  const item = (entry: ShellNavItem) => {
    const Icon = NAV_ICONS[entry.icon];
    const active = isNavItemActive(pathname, basePath, entry);
    const children = active ? (entry.children ?? []) : [];
    return (
      <SidebarMenuItem key={entry.key}>
        <SidebarMenuButton
          render={<Link href={entry.href} onNavigate={closeMobileNavigation} />}
          isActive={active}
          aria-current={active && !children.some((child) => isNavItemActive(pathname, basePath, child)) ? "page" : undefined}
          className={ITEM_CLASS}
        >
          <Icon className="size-4" aria-hidden />
          <span>{entry.title}</span>
        </SidebarMenuButton>
        {children.length > 0 ? (
          <SidebarMenuSub>
            {children.map((child) => {
              const childActive = isNavItemActive(pathname, basePath, child);
              return (
                <SidebarMenuSubItem key={child.key}>
                  <SidebarMenuSubButton
                    render={<Link href={child.href} onNavigate={closeMobileNavigation} />}
                    isActive={childActive}
                    aria-current={childActive ? "page" : undefined}
                    className="h-11 md:h-8"
                  >
                    <span>{child.title}</span>
                  </SidebarMenuSubButton>
                </SidebarMenuSubItem>
              );
            })}
          </SidebarMenuSub>
        ) : null}
      </SidebarMenuItem>
    );
  };

  return (
    <Sidebar>
      <SidebarHeader className="h-14 flex-row items-center justify-between gap-1 border-b border-sidebar-border px-2 py-0">
        {workspaceId && workspaceName ? (
          <WorkspaceSwitcher workspaceName={workspaceName} onNavigate={closeMobileNavigation} />
        ) : (
          <span className="px-2 text-sm font-semibold tracking-wide text-sidebar-foreground">{T.brand}</span>
        )}
        {/* Al telefono la campanella sta nella barra in alto: una sola alla volta. */}
        {bell && !isMobile ? <BellSlot bell={bell} /> : null}
      </SidebarHeader>

      <SidebarContent>
        <nav aria-label={T.nav.label} className="contents">
          <SidebarGroup className="py-3">
            <SidebarGroupContent>
              <SidebarMenu className="gap-0.5">{nav.main.map(item)}</SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
          {nav.tools.length > 0 ? (
            // Una linea sottile e nessun titolo: il nome del gruppo lo sentono solo i lettori di schermo.
            <SidebarGroup role="group" aria-label={T.nav.toolsLabel} className="pt-0">
              <SidebarGroupContent className="border-t border-sidebar-border pt-3">
                <SidebarMenu className="gap-0.5">{nav.tools.map(item)}</SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          ) : null}
        </nav>
      </SidebarContent>

      <SidebarFooter className="gap-1 border-t border-sidebar-border">
        {nav.settings ? <SidebarMenu>{item(nav.settings)}</SidebarMenu> : null}
        <SidebarMenu>
          <SidebarMenuItem>
            <DropdownMenu>
              {/* Il nome e l'e-mail dicono che cosa apre: nessuna etichetta che li copra. */}
              <DropdownMenuTrigger
                className="flex min-h-11 w-full items-center gap-2.5 rounded-lg p-2 text-left text-sm outline-hidden hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-sidebar-ring data-popup-open:bg-sidebar-accent"
              >
                <Avatar className="size-8">
                  <AvatarImage src={user.image ?? undefined} />
                  <AvatarFallback className="text-xs">{initials}</AvatarFallback>
                </Avatar>
                <span className="flex min-w-0 flex-1 flex-col text-left text-sm leading-tight">
                  <span className="truncate font-medium text-sidebar-foreground">{user.name ?? T.user.fallbackName}</span>
                  <span className="truncate text-xs text-muted-foreground">{user.email}</span>
                </span>
                <ChevronUp className="size-4 text-muted-foreground" aria-hidden />
              </DropdownMenuTrigger>
              <DropdownMenuContent side="top" align="start" className="w-56">
                {/* (Ondata 0) Le voci fanno loro stesse l'azione: con il mouse, il dito o Invio. */}
                {workspaceId ? (
                  <DropdownMenuItem onClick={openAccount} className={MENU_ITEM_CLASS}>
                    <UserRound aria-hidden />
                    {T.user.account}
                  </DropdownMenuItem>
                ) : null}
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger className={MENU_ITEM_CLASS}>
                    <Palette aria-hidden />
                    {T.user.theme}
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent className="w-48">
                    <ThemeMenuGroup />
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={handleLogout} className={MENU_ITEM_CLASS}>
                  <LogOut aria-hidden />
                  {T.user.signOut}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
