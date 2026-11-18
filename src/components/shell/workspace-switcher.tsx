"use client";

import Link from "next/link";
import { ChevronDown, LayoutGrid, Plus } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLinkItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { NEW_WORKSPACE_HREF, WORKSPACE_LIST_HREF } from "./sidebar-model";
import { SHELL_TEXT } from "@/lib/shell/text";

const T = SHELL_TEXT.switcher;
const ITEM = "min-h-11 gap-2 sm:min-h-8";

/**
 * Il nome del workspace in cima alla barra laterale è un selettore (rilascio 10, PROPOSTA-10 §2.1): «Tutti i
 * workspace» apre l'elenco anche a chi ne ha uno solo (che altrimenti entra diretto, D1), «Nuovo workspace» apre la
 * creazione. Voci che sono link, come «I miei workspace» di prima nel menu sotto il nome.
 */
export function WorkspaceSwitcher({ workspaceName, onNavigate }: { workspaceName: string; onNavigate?: () => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={T.label(workspaceName)}
        className="flex h-11 min-w-0 flex-1 items-center gap-1.5 rounded-lg px-2 text-left text-sm font-semibold text-sidebar-foreground outline-hidden hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-sidebar-ring data-popup-open:bg-sidebar-accent md:h-9"
      >
        <span className="truncate">{workspaceName}</span>
        <ChevronDown className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        <DropdownMenuLinkItem render={<Link href={WORKSPACE_LIST_HREF} onNavigate={onNavigate} />} className={ITEM}>
          <LayoutGrid aria-hidden />
          {T.all}
        </DropdownMenuLinkItem>
        <DropdownMenuLinkItem render={<Link href={NEW_WORKSPACE_HREF} onNavigate={onNavigate} />} className={ITEM}>
          <Plus aria-hidden />
          {T.create}
        </DropdownMenuLinkItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
