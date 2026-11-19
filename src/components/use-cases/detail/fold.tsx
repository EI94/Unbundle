"use client";

import { useRef, useState, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { keepTogether } from "@/lib/use-cases/line-breaks";
import { cn } from "@/lib/utils";
import { useArrivalOpen, useLanding } from "./arrival";

export interface FoldProps {
  /** L'ancora della piega (`?capitolo=`, `#storia`): la piega la tiene, le parti dentro no. */
  id: string;
  title: string;
  /** La riga grigia accanto al titolo (`foldSummaries`). */
  summary?: string | null;
  /** Aperta anche per un motivo dell'indirizzo che non è l'arrivo: «Mostra tutto» della Storia. */
  open?: boolean;
  /** Le ancore dentro la piega che la aprono anche all'arrivo della pagina (`?capitolo=richieste` apre «Cosa serve»). */
  within?: readonly string[];
  /** Dopo il titolo e la riga grigia, prima della freccia: la barra di «Cosa serve». */
  extra?: ReactNode;
  /** `riga`: una linea sopra e sotto, come le pieghe in fondo alla scheda; `riquadro`: un riquadro, come «Cosa serve · N». */
  look?: "riga" | "riquadro";
  /** `data-slot` della piega; predefinito `fold`. */
  slot?: string;
  children: ReactNode;
  className?: string;
}

/** La piega nasce aperta quando l'arrivo della navigazione è lei o un'ancora dentro di lei. */
export function foldLanded(id: string, landing: string | null, within: readonly string[] = []): boolean {
  return landing !== null && (landing === id || within.includes(landing));
}

/**
 * Una piega della scheda (rilascio 3; rilascio 10, §5.4): «Valutazione del team», «Dettagli», «Contesto»,
 * «Realizzazione», «Storia» e la riga «Cosa serve · N». Come `Fold` di `src/components/ui-10/`: il titolo è un vero
 * H2 con dentro il pulsante `aria-expanded` e `aria-controls`, la riga grigia di riepilogo e la freccia; il
 * contenuto sta in una regione nascosta finché è chiusa (`hidden`: la pagina resa dal server lo porta già). In più
 * conosce l'arrivo della scheda: nasce aperta quando la pagina arriva con il suo `?capitolo=` (o quello di un'ancora
 * dentro di lei, `within`), si apre quando un link della pagina o un `#ancora` la chiede (`arriveAt` le manda
 * `ARRIVAL_OPEN_EVENT`), poi la apre e la chiude chi guarda. Aperta o no all'arrivo lo dice la navigazione
 * (`useLanding` di `Arrival`), non il passo di adesso: la rilettura dopo un'azione (il passo che cambia con
 * «Quando», un requisito aggiunto) non la apre né la chiude da sé.
 */
export function Fold({ id, title, summary, open = false, within, extra, look = "riga", slot = "fold", children, className }: FoldProps) {
  const ref = useRef<HTMLElement>(null);
  const wanted = foldLanded(id, useLanding(), within) || open;
  const [shown, setShown] = useState(wanted);
  // Una navigazione nuova (un altro `?capitolo=`, Indietro e Avanti) decide di nuovo, come l'attributo `open` di prima.
  const [lastWanted, setLastWanted] = useState(wanted);
  if (wanted !== lastWanted) {
    setLastWanted(wanted);
    setShown(wanted);
  }
  useArrivalOpen(ref, () => setShown(true));
  const contentId = `${id}-contenuto`;
  const card = look === "riquadro";
  return (
    <section
      ref={ref}
      id={id}
      data-slot={slot}
      data-arrival-host=""
      data-open={shown ? "" : undefined}
      className={cn("scroll-mt-20", card ? "rounded-xl border bg-card" : "border-t last:border-b", className)}
    >
      <h2 className="text-base font-semibold">
        <button
          type="button"
          data-arrival-toggle=""
          aria-expanded={shown}
          aria-controls={contentId}
          onClick={() => setShown((now) => !now)}
          className={cn(
            "flex min-h-11 w-full min-w-0 items-center gap-3 rounded-md py-3 text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50 sm:min-h-12",
            card && "rounded-xl px-4",
          )}
        >
          <span className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-3 gap-y-0.5">
            <span className="min-w-0 break-words">{title}</span>
            {summary ? <span className="min-w-0 text-sm font-normal text-muted-foreground">{keepTogether(summary)}</span> : null}
          </span>
          {extra}
          <ChevronRight aria-hidden className={cn("size-4 shrink-0 text-muted-foreground transition-transform duration-150 motion-reduce:transition-none", shown && "rotate-90")} />
        </button>
      </h2>
      <div id={contentId} data-slot="fold-content" hidden={!shown} className={cn("space-y-4 pb-5", card && "border-t px-4 pt-4")}>
        {children}
      </div>
    </section>
  );
}
