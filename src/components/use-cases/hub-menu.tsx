"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ActionMenu } from "@/components/uc/ui/action-menu";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { proposeFromActivityMappingAction } from "@/lib/actions/use-case-create";
import { ACTIVITY_MAPPING_TEXT, type ActivityMappingState } from "@/lib/use-cases/create";
import { isNextNavigation } from "./decision-buttons";

/** Testi del menu «⋯» (docs/use-case/DESIGN.md §4.1, §8.5, §14.3). */
export const HUB_MENU_TEXT = Object.freeze({
  label: "Altre azioni",
  export: "Esporta Excel",
  openMapping: "Apri Activity mapping",
});

/** Una voce che apre una pagina dell'area: i grafici di «Priorità» (`?mostra=matrice|benefici`). */
export interface HubMenuLink {
  label: string;
  href: string;
}

export interface HubMenuProps {
  workspaceId: string;
  /** I grafici di «Priorità › Da costruire», in cima; vuoto senza use case da mettere in ordine. */
  charts?: readonly HubMenuLink[];
  /** `/portfolio/export`: con l'area accesa il foglio «Use case» (§4.1). */
  exportHref: string;
  /** Le attività del workspace: da classificare, nessuna, oppure pronte (`activityMappingReadiness`). */
  activityMapping: ActivityMappingState;
  /** `/mapping`, per «Prima classifica le attività in Activity mapping.». */
  mappingHref: string;
}

/**
 * Il menu «⋯» della pagina, solo per i revisori (§4.1). In cima i grafici di «Priorità › Da
 * costruire»: «Matrice Valore × Costo» e, con «Benefici e costi», «Matrice Facilità × Beneficio»;
 * ognuno si apre al posto della lista, con i filtri di adesso. Poi «Esporta Excel» e «Proponi da
 * Activity mapping». L'ultimo, con attività da classificare, dice «Prima classifica le attività in
 * Activity mapping.» con il link; altrimenti chiede conferma e fa proporre a Claude nuovi use
 * case, che arrivano in «Da decidere», nascosti ai colleghi, mai approvati da soli (§8.5).
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
      <ActionMenu
        label={HUB_MENU_TEXT.label}
        items={[
          // I grafici sono pagine dell'area: link, con i filtri di adesso.
          ...charts.map(({ label, href }) => ({ label, href })),
          // Un file da scaricare: navigazione piena, non una pagina dell'app.
          { label: HUB_MENU_TEXT.export, onSelect: () => window.location.assign(exportHref) },
          { label: ACTIVITY_MAPPING_TEXT.menuItem, onSelect: () => setOpen(true) },
        ]}
      />
      <Dialog open={open} onOpenChange={(next) => (pending ? undefined : setOpen(next))}>
        <DialogContent showCloseButton={false} className="sm:max-w-md">
          {ready ? (
            <>
              <DialogHeader>
                <DialogTitle>{ACTIVITY_MAPPING_TEXT.dialogTitle}</DialogTitle>
                <DialogDescription>{ACTIVITY_MAPPING_TEXT.dialogBody}</DialogDescription>
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
                <DialogDescription>{ACTIVITY_MAPPING_TEXT.classifyFirst}</DialogDescription>
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
