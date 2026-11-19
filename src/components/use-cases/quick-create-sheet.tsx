"use client";

import { useRef } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetClose, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import type { CostBandInfo } from "@/lib/use-cases/cost-bands";
import { QUICK_CREATE_TEXT, defaultOriginFor } from "@/lib/use-cases/create";
import { UseCaseForm } from "./use-case-form";

export interface QuickCreateSheetProps {
  workspaceId: string;
  /** I valori di «AI Lab» del workspace, dal più recente (`quickCreateOptions`). */
  aiLabs?: readonly string[];
  /** L'ultimo «AI Lab» usato nel workspace: il campo parte da qui. */
  lastAiLab?: string | null;
  /** (Rilascio 10) «Impatto ambientale e sociale» in «Aggiungi dettagli», solo con ESG attivo. */
  esgEnabled?: boolean;
  /** (Rilascio 10) Le fasce del costo del workspace, per «Valutazione iniziale». */
  costBands?: readonly CostBandInfo[];
  /** Controllato. Senza, il pannello segue il parametro `?nuovo=1` della pagina. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Controllato: «Salva» chiude e chiede di aprire la scheda. Senza, `?apri=<id>`. */
  onSaved?: (useCaseId: string) => void;
}

/** L'indirizzo della pagina con alcuni parametri cambiati (`null` lo toglie). */
function urlWith(pathname: string, params: URLSearchParams, change: Record<string, string | null>): string {
  const next = new URLSearchParams(params.toString());
  for (const [key, value] of Object.entries(change)) {
    if (value === null) next.delete(key);
    else next.set(key, value);
  }
  const query = next.toString();
  return query ? `${pathname}?${query}` : pathname;
}

/**
 * Il pannello rapido di «Nuovo use case» (docs/use-case/DESIGN.md §5.1, §5.2, §8.1), per le persone di Lateral Space
 * con ruolo da revisore, durante un AI Lab. (Rilascio 10, §3.4, D8) Dentro c'è lo stesso modulo della pagina
 * (`UseCaseForm`, variante «pannello»): il tipo, Titolo e Problema in vista, il resto in «Aggiungi dettagli» con «AI
 * Lab» in testa, e per i revisori Origine («Dall'alto» di partenza) e Valutazione iniziale.
 *
 * - «Salva» (il pulsante pieno, anche Invio in un campo di una riga): salva, chiude e apre lo use case nel pannello
 *   laterale (`?apri=<id>`).
 * - «Salva e aggiungi un altro» (bordato): salva, svuota i campi, tiene tipo, origine e AI Lab, rimette il fuoco sul
 *   titolo e mostra l'avviso «XX-0031 salvato.».
 * - Errore: «Non riusciamo a salvare. Riprova.», i campi restano compilati.
 *
 * Lo monta la pagina «Use case» quando c'è `?nuovo=1`; il salvataggio passa da `createQuickUseCaseAction`
 * (`source = manual`: nessuna valutazione dell'AI, nessuna notifica, come prima).
 */
export function QuickCreateSheet({ workspaceId, aiLabs = [], lastAiLab = null, esgEnabled = false, costBands, open: openProp, onOpenChange, onSaved }: QuickCreateSheetProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const open = openProp ?? searchParams.get("nuovo") === "1";
  const titleRef = useRef<HTMLInputElement>(null);

  function close(change: Record<string, string | null> = {}) {
    onOpenChange?.(false);
    if (openProp === undefined) router.replace(urlWith(pathname, new URLSearchParams(searchParams.toString()), { nuovo: null, ...change }), { scroll: false });
  }

  return (
    <Sheet open={open} onOpenChange={(next) => (next ? undefined : close())}>
      <SheetContent
        side="right"
        showCloseButton={false}
        initialFocus={titleRef}
        className="gap-0 overflow-y-auto data-[side=right]:w-full data-[side=right]:sm:max-w-lg"
        data-slot="quick-create-sheet"
      >
        <SheetHeader className="flex-row items-center justify-between gap-2 border-b px-4 py-3">
          <SheetTitle className="text-base font-semibold">{QUICK_CREATE_TEXT.heading}</SheetTitle>
          <SheetClose render={<Button variant="ghost" size="icon" className="size-11 sm:size-8" aria-label={QUICK_CREATE_TEXT.close} />}>
            <X aria-hidden />
          </SheetClose>
        </SheetHeader>
        <div className="p-4">
          <UseCaseForm
            workspaceId={workspaceId}
            variant="pannello"
            isReviewer
            defaultOrigin={defaultOriginFor("pannello_rapido", { isLateralSpace: true, isReviewer: true })}
            esgEnabled={esgEnabled}
            costBands={costBands}
            aiLabs={aiLabs}
            lastAiLab={lastAiLab}
            titleRef={titleRef}
            onSaved={(id) => {
              onSaved?.(id);
              close(onSaved ? {} : { apri: id });
            }}
          />
        </div>
      </SheetContent>
    </Sheet>
  );
}
