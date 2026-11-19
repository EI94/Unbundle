"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Menu as MenuPrimitive } from "@base-ui/react/menu";
import { MoreHorizontal } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { proposeFromActivityMappingAction } from "@/lib/actions/use-case-create";
import { ACTIVITY_MAPPING_TEXT, type ActivityMappingState } from "@/lib/use-cases/create";
import { keepTogether } from "@/lib/use-cases/line-breaks";
import { isNextNavigation } from "./decision-buttons";

/** Testi del menu «⋯» (docs/use-case/DESIGN.md §4.1, §8.5, §14.3; rilascio 10, §3.4). */
export const HUB_MENU_TEXT = Object.freeze({
  label: "Altre azioni",
  /** Il sottomenu dei grafici: «Matrice» e «Curva del valore». */
  charts: "Grafici",
  export: "Esporta in Excel",
  openMapping: "Apri i processi",
});

/** Una voce che apre una pagina dell'area: i grafici della Panoramica (`?mostra=matrice|curva`). */
export interface HubMenuLink {
  label: string;
  href: string;
}

export interface HubMenuProps {
  workspaceId: string;
  /**
   * Le voci di «Grafici ›» (`hubChartMenu`: «Matrice», poi «Curva del valore»), con i filtri di adesso; vuoto senza
   * use case da mettere in ordine e senza «Benefici e costi» tra gli approvati e in realizzazione: allora «Grafici» non c'è.
   */
  charts?: readonly HubMenuLink[];
  /** `/portfolio/export`: con l'area accesa il foglio «Use case» (§4.1). */
  exportHref: string;
  /** Le attività del workspace: da classificare, nessuna, oppure pronte (`activityMappingReadiness`). */
  activityMapping: ActivityMappingState;
  /** `/mapping`, per «Prima classifica i passi nei processi.». */
  mappingHref: string;
}

/** Le voci del menu, come quelle di `ActionMenu`: 44 px al telefono, 32 px da 640 px. */
const ITEM =
  "flex min-h-11 w-full cursor-default items-center gap-1.5 rounded-md px-2 py-2 text-sm outline-hidden select-none focus:bg-accent focus:text-accent-foreground sm:min-h-8 sm:py-1.5";

/**
 * Il menu «⋯» della pagina, solo per i revisori (rilascio 10, §3.4, prototipo S2), in quest'ordine:
 * - «Grafici ›», un sottomenu con «Matrice» (una sola, con l'interruttore «Valore × Costo | Facilità × Beneficio»
 *   sopra il grafico) e «Curva del valore»: si aprono nella Panoramica al posto delle corsie, con i filtri di adesso e
 *   «‹ Torna alla Panoramica» sopra;
 * - «Proponi dai processi»: con passi da classificare dice «Prima classifica i passi nei processi.» con il link;
 *   altrimenti chiede conferma e fa proporre a Claude nuovi use case, che arrivano in «Da decidere», non visibili in
 *   azienda, mai approvati da soli (§8.5);
 * - «Esporta in Excel»: il foglio «Use case», un file da scaricare.
 */
export function HubMenu({ workspaceId, charts = [], exportHref, activityMapping, mappingHref }: HubMenuProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const ready = activityMapping === "pronto";

  function propose() {
    if (pending) return;
    startTransition(async () => {
      let result: Awaited<ReturnType<typeof proposeFromActivityMappingAction>>;
      try {
        result = await proposeFromActivityMappingAction(workspaceId);
      } catch (error) {
        if (!isNextNavigation(error)) toast.error(ACTIVITY_MAPPING_TEXT.error);
        return;
      }
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      setOpen(false);
      toast.success(result.message);
      router.refresh();
    });
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          data-action="hub-menu"
          render={<Button variant="outline" size="icon" aria-label={HUB_MENU_TEXT.label} className="size-11 sm:size-8" />}
        >
          <MoreHorizontal aria-hidden />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-auto min-w-48 max-w-[min(20rem,calc(100vw-2rem))]">
          {charts.length ? (
            // I grafici sono pagine dell'area: link, con i filtri di adesso.
            <DropdownMenuSub>
              <DropdownMenuSubTrigger data-action="charts-menu" className={ITEM}>
                {HUB_MENU_TEXT.charts}
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="w-auto min-w-44 max-w-[min(20rem,calc(100vw-2rem))]">
                {charts.map((link) => (
                  <MenuPrimitive.LinkItem key={link.href} data-slot="dropdown-menu-item" closeOnClick render={<Link href={link.href} />} className={ITEM}>
                    {link.label}
                  </MenuPrimitive.LinkItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          ) : null}
          <DropdownMenuItem className={ITEM} onClick={() => setOpen(true)}>
            {ACTIVITY_MAPPING_TEXT.menuItem}
          </DropdownMenuItem>
          {/* Un file da scaricare: navigazione piena, non una pagina dell'app. */}
          <DropdownMenuItem className={ITEM} onClick={() => window.location.assign(exportHref)}>
            {HUB_MENU_TEXT.export}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Dialog open={open} onOpenChange={(next) => (pending ? undefined : setOpen(next))}>
        <DialogContent showCloseButton={false} className="sm:max-w-md">
          {ready ? (
            <>
              <DialogHeader>
                <DialogTitle>{ACTIVITY_MAPPING_TEXT.dialogTitle}</DialogTitle>
                <DialogDescription>{keepTogether(ACTIVITY_MAPPING_TEXT.dialogBody)}</DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <DialogClose render={<Button variant="outline" className="min-h-11 sm:min-h-8" disabled={pending} />}>{ACTIVITY_MAPPING_TEXT.cancel}</DialogClose>
                <Button className="min-h-11 sm:min-h-8" aria-busy={pending || undefined} onClick={propose}>
                  {ACTIVITY_MAPPING_TEXT.confirm}
                </Button>
              </DialogFooter>
            </>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle>{ACTIVITY_MAPPING_TEXT.menuItem}</DialogTitle>
                <DialogDescription>{keepTogether(ACTIVITY_MAPPING_TEXT.classifyFirst)}</DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <DialogClose render={<Button variant="outline" className="min-h-11 sm:min-h-8" />}>{ACTIVITY_MAPPING_TEXT.cancel}</DialogClose>
                <Button className="min-h-11 sm:min-h-8" render={<Link href={mappingHref} />} nativeButton={false}>
                  {HUB_MENU_TEXT.openMapping}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
