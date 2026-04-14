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
} from "@/components/ui/sidebar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  LayoutDashboard,
  MessageSquare,
  Building2,
  Map,
  Target,
  Lightbulb,
  FileText,
  Settings,
  LogOut,
  ChevronUp,
  Compass,
  GitBranch,
  Bot,
  Cpu,
  FlaskConical,
  Radar,
} from "lucide-react";

interface AppSidebarProps {
  workspaceId?: string;
  workspaceName?: string;
  user: {
    name?: string | null;
    email?: string | null;
    image?: string | null;
  };
}

export function AppSidebar({
  workspaceId,
  workspaceName,
  user,
}: AppSidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const basePath = workspaceId ? `/dashboard/${workspaceId}` : "/dashboard";

  const handleLogout = async () => {
    await fetch("/api/auth/session", { method: "DELETE" });
    await signOut(firebaseAuth).catch(() => {});
    router.push("/login");
  };

  const workspaceNav = workspaceId
    ? [
        { title: "Overview", href: basePath, icon: LayoutDashboard },
        { title: "Discovery", href: `${basePath}/setup/leadership`, icon: Compass },
        { title: "Contesto", href: `${basePath}/setup/context`, icon: Building2 },
        { title: "Strategia", href: `${basePath}/strategy`, icon: Target },
        { title: "Activity mapping", href: `${basePath}/mapping`, icon: GitBranch },
        { title: "Value map", href: `${basePath}/value-map`, icon: Map },
        { title: "Use cases", href: `${basePath}/use-cases`, icon: Lightbulb },
        { title: "Piano", href: `${basePath}/plan`, icon: FileText },
        { title: "Report", href: `${basePath}/reports`, icon: FileText },
        { title: "Blueprints", href: `${basePath}/blueprints`, icon: Bot },
        { title: "Simulazione", href: `${basePath}/simulation`, icon: FlaskConical },
        { title: "Intelligence", href: `${basePath}/intelligence`, icon: Radar },
        { title: "Integrazioni", href: `${basePath}/settings`, icon: Settings },
      ]
    : [];

  const initials = user.name
    ? user.name.split(" ").map((n) => n[0]).join("").toUpperCase()
    : user.email?.[0]?.toUpperCase() ?? "U";

  return (
    <Sidebar>
      <SidebarHeader className="border-b border-sidebar-border px-4 py-4">
        <Link href="/dashboard" className="flex flex-col gap-0.5">
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
                      render={<Link href={item.href} />}
                      isActive={pathname === item.href}
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
                    render={<Link href="/dashboard" />}
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
                  <Link href="/dashboard" className="flex items-center w-full">
                    <Settings className="mr-2 h-4 w-4" />
                    Impostazioni
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
