"use client";

import { Fragment } from "react";
import { MoreHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

/** Una voce del «⋯» della scheda: un'azione, oppure un interruttore («Visibile in azienda»). */
export type SchedaMenuItem =
  | { kind: "azione"; label: string; onSelect: () => void; destructive?: boolean }
  | { kind: "interruttore"; label: string; checked: boolean; onCheckedChange: (checked: boolean) => void };

/** Un gruppo di voci con il suo titolo («Decisione», «Scheda»). */
export interface SchedaMenuGroup {
  label: string;
  items: readonly SchedaMenuItem[];
}

/** Le voci alte 44 px al telefono, 32 px da 640 px, come quelle di `ActionMenu`. */
const ITEM = "min-h-11 px-2 py-2 sm:min-h-8 sm:py-1.5";

/**
 * (Rilascio 10, §3.4, §5.5) Il solo «⋯» della testata della scheda: le voci in gruppi con un titolo, una linea tra un
 * gruppo e l'altro. Un gruppo senza voci non c'è; senza nessuna voce il menu non c'è (chi non ha azioni non vede il
 * pulsante). Le voci arrivano già filtrate per chi guarda: mai voci spente.
 */
export function SchedaMenu({ groups, label, className }: { groups: readonly SchedaMenuGroup[]; label: string; className?: string }) {
  const shown = groups.filter((group) => group.items.length > 0);
  if (!shown.length) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="outline" size="icon" aria-label={label} className={cn("size-11 sm:size-8", className)} />}>
        <MoreHorizontal aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" data-slot="scheda-menu" className="w-auto min-w-52 max-w-[min(20rem,calc(100vw-2rem))]">
        {shown.map((group, index) => (
          <Fragment key={group.label}>
            {index > 0 ? <DropdownMenuSeparator /> : null}
            <DropdownMenuGroup>
              <DropdownMenuLabel>{group.label}</DropdownMenuLabel>
              {group.items.map((item) =>
                item.kind === "interruttore" ? (
                  <DropdownMenuCheckboxItem key={item.label} checked={item.checked} onCheckedChange={(checked) => item.onCheckedChange(checked)} className={cn(ITEM, "pr-8")}>
                    {item.label}
                  </DropdownMenuCheckboxItem>
                ) : (
                  <DropdownMenuItem key={item.label} variant={item.destructive ? "destructive" : "default"} onClick={item.onSelect} className={ITEM}>
                    {item.label}
                  </DropdownMenuItem>
                ),
              )}
            </DropdownMenuGroup>
          </Fragment>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
