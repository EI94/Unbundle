"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { Menu } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useSidebar } from "@/components/ui/sidebar";
import { BellSlot } from "./bell-slot";
import { activeNavTitle, navBase, type ShellNav } from "./sidebar-model";
import { SHELL_TEXT } from "@/lib/shell/text";

/**
 * La barra in alto del telefono (rilascio 10, PROPOSTA-10 §2.1, §5.7): 56 px, «☰» che apre la barra laterale come
 * foglio, il titolo della pagina (la voce accesa, o la sua vista), la campanella. Da 768 px non c'è: la pagina comincia
 * subito e la campanella sta nella testata della barra laterale.
 */
export function PhoneTopbar({ nav, workspaceId, fallbackTitle, bell }: { nav: ShellNav; workspaceId?: string; fallbackTitle: string; bell?: ReactNode }) {
  const { isMobile, toggleSidebar } = useSidebar();
  const pathname = usePathname() ?? "";
  const title = activeNavTitle(nav, pathname, navBase(workspaceId)) ?? fallbackTitle;
  return (
    <header
      data-slot="phone-topbar"
      className="sticky top-0 z-20 flex h-14 shrink-0 items-center justify-between gap-2 border-b bg-background/90 px-1.5 backdrop-blur md:hidden"
    >
      <Button variant="ghost" size="icon" className="size-11" aria-label={SHELL_TEXT.topbar.openMenu} onClick={toggleSidebar}>
        <Menu aria-hidden />
      </Button>
      <p className="absolute left-1/2 max-w-[calc(100%-7.5rem)] -translate-x-1/2 truncate text-base font-semibold">{title}</p>
      {/* La campanella qui solo al telefono: su desktop sta nella barra laterale (una sola alla volta). */}
      {bell && isMobile ? <BellSlot bell={bell} /> : <span aria-hidden className="size-11" />}
    </header>
  );
}
