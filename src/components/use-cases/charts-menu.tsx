"use client";

import Link from "next/link";
import { Menu as MenuPrimitive } from "@base-ui/react/menu";
import { ChartScatter, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

/** I testi del menu dei grafici (rilascio 5, §12, D30). */
export const CHARTS_MENU_TEXT = Object.freeze({ label: "Grafici" });

export interface ChartsMenuLink {
  label: string;
  href: string;
}

/**
 * (Rilascio 5, §12, D30) «Grafici»: un pulsante a vista accanto a «Per trimestre | Per agente» (o da
 * solo) nella Panoramica e accanto a «‹ Torna alla Panoramica» su un grafico, con «Matrice Valore ×
 * Costo», «Matrice Facilità × Beneficio» e «Curva del valore», con i filtri di adesso. Solo ai
 * revisori (i contributori non vedono grafici); vuoto, niente.
 */
export function ChartsMenu({ links, className }: { links: readonly ChartsMenuLink[]; className?: string }) {
  if (links.length === 0) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger data-action="charts-menu" render={<Button variant="outline" className={className ? `min-h-11 shrink-0 gap-1.5 sm:min-h-8 ${className}` : "min-h-11 shrink-0 gap-1.5 sm:min-h-8"} />}>
        <ChartScatter aria-hidden />
        {CHARTS_MENU_TEXT.label}
        <ChevronDown aria-hidden className="text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-auto min-w-56 max-w-[min(20rem,calc(100vw-2rem))]">
        {links.map((link) => (
          <MenuPrimitive.LinkItem
            key={link.href}
            data-slot="dropdown-menu-item"
            closeOnClick
            render={<Link href={link.href} />}
            className="flex min-h-11 w-full cursor-default items-start gap-1.5 rounded-md px-2 py-2 text-sm outline-hidden select-none focus:bg-accent focus:text-accent-foreground sm:min-h-8 sm:py-1.5"
          >
            {link.label}
          </MenuPrimitive.LinkItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
