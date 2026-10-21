"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { signOut } from "firebase/auth";
import { firebaseAuth } from "@/lib/firebase/client";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { confirmLearningNavigation } from "@/components/learning/use-unsaved-changes";
import { USE_CASE_NAV_MATCH, isNavItemActive } from "@/components/dashboard/nav-active";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  LayoutDashboard,
  Building2,
  Map,
  Target,
  Lightbulb,
  FileText,
  Settings,
  LayoutGrid,
  LogOut,
  ChevronUp,
  Compass,
  GitBranch,
  Bot,
  FlaskConical,
  Radar,
  Inbox,
  ClipboardCheck,
  GraduationCap,
  ListChecks,
  type LucideIcon,
} from "lucide-react";

interface NavItem {
  title: string;
  href: string;
  icon: LucideIcon;
  /** Segmenti sotto il workspace per cui la voce resta accesa (`isNavItemActive`); `[]`: solo il suo indirizzo. */
  match?: readonly string[];
}

/** Solo l'indirizzo della voce: come accendeva la barra prima dell'area «Use case». */
const EXACT: readonly string[] = Object.freeze([]);

/** «Use case» mentre la voce «Casi d'uso» resta nella barra (P0-16 non ancora fatto): `/casi-duso` è sua. */
const USE_CASE_NAV_MATCH_WITHOUT_DOSSIERS: readonly string[] = Object.freeze(USE_CASE_NAV_MATCH.filter((segment) => segment !== "casi-duso"));

interface AppSidebarProps {
  learningAvailable?: boolean;
  /**
   * Voce «Casi d'uso»: sezione accesa e persona che vede i casi (mai chi segue solo un corso).
   * Con l'area «Use case» accesa il layout la chiede solo finché `dossierLinksReady` non è vero
   * (P0-16): allora la voce sta subito sotto «Use case», che lascia a lei `/casi-duso`.
   */
  casesAvailable?: boolean;
  /** Entrato da un link di corso: la navigazione si riduce al corso. */
  learnerOnly?: boolean;
  /**
   * Area «Use case» accesa per il workspace (`USE_CASE_HUB_WORKSPACES`, docs/use-case/DESIGN.md
   * §2.1, §12.1; D1): una voce «Use case» al posto di «Raccolta & ranking», «Use cases»,
   * «Casi d'uso» e «Piano», accesa anche sulle pagine che sostituisce (tranne `/casi-duso` finché
   * la voce «Casi d'uso» resta, vedi `casesAvailable`). Spenta: la barra di oggi.
   */
  useCaseHub?: boolean;
  workspaceId?: string;
  workspaceName?: string;
  user: {
    name?: string | null;
    email?: string | null;
    image?: string | null;
  };
}

export function AppSidebar({
  learningAvailable = false,
  casesAvailable = false,
  learnerOnly = false,
  useCaseHub = false,
  workspaceId,
  workspaceName,
  user,
}: AppSidebarProps) {
  const { isMobile, setOpenMobile } = useSidebar();
  const closeMobileNavigation = () => { if (isMobile) setOpenMobile(false); };
  const pathname = usePathname();
  const router = useRouter();
  const basePath = workspaceId ? `/dashboard/${workspaceId}` : "/dashboard";

  const handleLogout = async () => {
    if (!confirmLearningNavigation()) return;
    await fetch("/api/auth/session", { method: "DELETE" });
    await signOut(firebaseAuth).catch(() => {});
    closeMobileNavigation();
    router.push("/login");
  };

  // Area spenta: la barra di oggi, voce per voce, e ogni voce accesa solo sul suo indirizzo
  // (`EXACT`), tranne «Casi d'uso», che resta accesa dentro un dossier. Area accesa: ogni voce
  // resta accesa anche sulle sue pagine annidate (il predefinito di `isNavItemActive`).
  const own = useCaseHub ? undefined : EXACT;

  const learnerNav: NavItem[] = workspaceId
    ? [{ title: "Il mio corso", href: `${basePath}/learning`, icon: GraduationCap, match: own }]
    : [];

  const workspaceNav: NavItem[] = learnerOnly
    ? learnerNav
    : workspaceId
    ? [
        { title: "Overview", href: basePath, icon: LayoutDashboard },
        { title: "AI Readiness", href: `${basePath}/ai-readiness`, icon: ClipboardCheck, match: own },
        ...(learningAvailable ? [{ title: "Formazione", href: `${basePath}/learning`, icon: GraduationCap, match: own }] : []),
        ...(useCaseHub
          ? [
              { title: "Use case", href: `${basePath}/use-cases`, icon: Lightbulb, match: casesAvailable ? USE_CASE_NAV_MATCH_WITHOUT_DOSSIERS : USE_CASE_NAV_MATCH },
              ...(casesAvailable ? [{ title: "Casi d'uso", href: `${basePath}/casi-duso`, icon: ListChecks }] : []),
            ]
          : [{ title: "Raccolta & ranking", href: `${basePath}/portfolio`, icon: Inbox, match: EXACT }]),
        { title: "Discovery", href: `${basePath}/setup/leadership`, icon: Compass, match: own },
        { title: "Contesto", href: `${basePath}/setup/context`, icon: Building2, match: own },
        { title: "Strategia", href: `${basePath}/strategy`, icon: Target, match: own },
        { title: "Activity mapping", href: `${basePath}/mapping`, icon: GitBranch, match: own },
        { title: "Value map", href: `${basePath}/value-map`, icon: Map, match: own },
        // Con l'area accesa queste tre pagine stanno sotto «Use case» (i vecchi indirizzi reindirizzano).
        ...(useCaseHub
          ? []
          : [
              { title: "Use cases", href: `${basePath}/use-cases`, icon: Lightbulb, match: EXACT },
              ...(casesAvailable ? [{ title: "Casi d'uso", href: `${basePath}/casi-duso`, icon: ListChecks }] : []),
              { title: "Piano", href: `${basePath}/plan`, icon: FileText, match: EXACT },
            ]),
        { title: "Report", href: `${basePath}/reports`, icon: FileText, match: own },
        { title: "Blueprints", href: `${basePath}/blueprints`, icon: Bot, match: own },
        { title: "Simulazione", href: `${basePath}/simulation`, icon: FlaskConical, match: own },
        { title: "Intelligence", href: `${basePath}/intelligence`, icon: Radar, match: own },
        { title: "Impostazioni", href: `${basePath}/settings`, icon: Settings, match: own },
      ]
    : [];

  const initials = user.name
    ? user.name.split(" ").map((n) => n[0]).join("").toUpperCase()
    : user.email?.[0]?.toUpperCase() ?? "U";

  return (
    <Sidebar>
      <SidebarHeader className="border-b border-sidebar-border px-4 py-4">
        <Link onNavigate={closeMobileNavigation} href="/dashboard" className="flex flex-col gap-0.5">
          <span className="text-sm font-medium text-sidebar-foreground tracking-wide">
            Unbundle
          </span>
          {workspaceName && (
            <span className="text-xs text-sidebar-foreground/50 truncate max-w-[160px]">
              {workspaceName}
            </span>
          )}
        </Link>
      </SidebarHeader>

      <SidebarContent>
        {workspaceId ? (
          <SidebarGroup>
            <SidebarGroupLabel>Workspace</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {workspaceNav.map((item) => (
                  <SidebarMenuItem key={item.href}>
                    <SidebarMenuButton
                      render={<Link href={item.href} onNavigate={closeMobileNavigation} />}
                      isActive={isNavItemActive(pathname ?? "", basePath, item)}
                    >
                      <item.icon className="h-4 w-4" />
                      <span>{item.title}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ) : (
          <SidebarGroup>
            <SidebarGroupLabel>Navigazione</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    render={<Link onNavigate={closeMobileNavigation} href="/dashboard" />}
                    isActive={pathname === "/dashboard"}
                  >
                    <LayoutDashboard className="h-4 w-4" />
                    <span>I miei Workspace</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger
                className="flex w-full items-center gap-2 rounded-lg p-2 text-left text-sm hover:bg-sidebar-accent"
              >
                <Avatar className="h-8 w-8">
                  <AvatarImage src={user.image ?? undefined} />
                  <AvatarFallback className="text-xs">
                    {initials}
                  </AvatarFallback>
                </Avatar>
                <div className="flex flex-col text-left text-sm leading-tight flex-1 min-w-0">
                  <span className="truncate font-medium text-sidebar-foreground">
                    {user.name ?? "Utente"}
                  </span>
                  <span className="truncate text-xs text-sidebar-foreground/60">
                    {user.email}
                  </span>
                </div>
                <ChevronUp className="h-4 w-4 text-sidebar-foreground/60" />
              </DropdownMenuTrigger>
              <DropdownMenuContent side="top" align="start" className="w-56">
                <DropdownMenuItem>
                  <Link onNavigate={closeMobileNavigation} href="/dashboard" className="flex items-center w-full">
                    <LayoutGrid className="mr-2 h-4 w-4" />
                    I miei workspace
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem>
                  <button
                    onClick={handleLogout}
                    className="flex w-full items-center text-sm"
                  >
                    <LogOut className="mr-2 h-4 w-4" />
                    Esci
                  </button>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
