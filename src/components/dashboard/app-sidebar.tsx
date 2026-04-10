"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
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
  const basePath = workspaceId ? `/dashboard/${workspaceId}` : "/dashboard";

  const workspaceNav = workspaceId
    ? [
        { title: "Overview", href: basePath, icon: LayoutDashboard },
        { title: "Setup Leadership", href: `${basePath}/setup/leadership`, icon: Compass },
        { title: "Contesto Org.", href: `${basePath}/setup/context`, icon: Building2 },
        { title: "Strategia & OKR", href: `${basePath}/strategy`, icon: Target },
        { title: "Activity Mapping", href: `${basePath}/mapping`, icon: GitBranch },
        { title: "Value Map", href: `${basePath}/value-map`, icon: Map },
        { title: "Use Cases", href: `${basePath}/use-cases`, icon: Lightbulb },
        { title: "Unbundle Plan", href: `${basePath}/plan`, icon: FileText },
        { title: "Report", href: `${basePath}/reports`, icon: FileText },
        { title: "Agent Blueprints", href: `${basePath}/blueprints`, icon: Bot },
        { title: "Simulazione", href: `${basePath}/simulation`, icon: FlaskConical },
        { title: "Intelligence", href: `${basePath}/intelligence`, icon: Radar },
      ]
    : [];

  const initials = user.name
    ? user.name.split(" ").map((n) => n[0]).join("").toUpperCase()
    : user.email?.[0]?.toUpperCase() ?? "U";

  return (
    <Sidebar>
      <SidebarHeader className="border-b border-sidebar-border px-4 py-4">
        <Link href="/dashboard" className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground font-bold text-sm">
            U
          </div>
          <div className="flex flex-col">
            <span className="text-sm font-semibold text-sidebar-foreground">
              Unbundle
            </span>
            {workspaceName && (
              <span className="text-xs text-sidebar-foreground/60 truncate max-w-[140px]">
                {workspaceName}
              </span>
            )}
          </div>
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
                  <form
                    action="/api/auth/signout"
                    method="POST"
                    className="w-full"
                  >
                    <button
                      type="submit"
                      className="flex w-full items-center text-sm"
                    >
                      <LogOut className="mr-2 h-4 w-4" />
                      Esci
                    </button>
                  </form>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
