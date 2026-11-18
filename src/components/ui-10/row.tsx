import type { ReactNode } from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

/** Le classi di una riga: alta almeno 44 px al telefono, 48 px da 640 px; il fuoco si vede. */
const ROW = "group flex min-h-11 w-full min-w-0 items-center gap-3 px-4 py-3 text-left text-sm outline-none transition-colors hover:bg-muted/40 focus-visible:ring-3 focus-visible:ring-inset focus-visible:ring-ring/50 sm:min-h-12";

export interface RowProps {
  title: ReactNode;
  /** Un fatto grigio, a destra da 640 px e sotto il titolo al telefono. */
  fact?: ReactNode;
  /** Prima del titolo: un tag, un'icona, la spunta di «Per partire». */
  leading?: ReactNode;
  /** Dopo il fatto, prima della freccia: una pillola di stato. */
  trailing?: ReactNode;
  /** Un link: tutta la riga porta lì. */
  href?: string;
  /** Un'azione della pagina (un pannello): solo da un componente client. */
  onClick?: () => void;
  /** Il pannello che la riga apre, per `aria-haspopup`. */
  opensPanel?: boolean;
  className?: string;
  "data-row"?: string;
}

function RowBody({ title, fact, leading, trailing, arrow }: Pick<RowProps, "title" | "fact" | "leading" | "trailing"> & { arrow: boolean }) {
  return (
    <>
      {leading ? <span className="flex shrink-0 items-center">{leading}</span> : null}
      <span className="flex min-w-0 flex-1 flex-col gap-0.5 sm:flex-row sm:items-baseline sm:justify-between sm:gap-6">
        <span className="min-w-0 font-medium break-words">{title}</span>
        {fact ? <span className="min-w-0 text-muted-foreground sm:text-right">{fact}</span> : null}
      </span>
      {trailing ? <span className="flex shrink-0 items-center">{trailing}</span> : null}
      {arrow ? <ChevronRight aria-hidden className="size-4 shrink-0 text-muted-foreground group-hover:text-foreground" /> : null}
    </>
  );
}

/**
 * `Row` (rilascio 10, docs/ui-10/PROPOSTA-10.md §5.4): una riga per oggetto, con un titolo, un fatto grigio e la
 * freccia. Un link (`href`), un pulsante che apre un pannello (`onClick`) o, senza nessuno dei due, una riga ferma
 * senza freccia. Le righe stanno in una `RowList`.
 */
export function Row({ title, fact, leading, trailing, href, onClick, opensPanel, className, ...rest }: RowProps) {
  const data = rest["data-row"];
  if (href) {
    return (
      <Link href={href} data-slot="row" data-row={data} className={cn(ROW, className)}>
        <RowBody title={title} fact={fact} leading={leading} trailing={trailing} arrow />
      </Link>
    );
  }
  if (onClick) {
    return (
      <button type="button" onClick={onClick} aria-haspopup={opensPanel ? "dialog" : undefined} data-slot="row" data-row={data} className={cn(ROW, className)}>
        <RowBody title={title} fact={fact} leading={leading} trailing={trailing} arrow />
      </button>
    );
  }
  return (
    <div data-slot="row" data-row={data} className={cn(ROW, "hover:bg-transparent", className)}>
      <RowBody title={title} fact={fact} leading={leading} trailing={trailing} arrow={false} />
    </div>
  );
}

/** Le righe in una cornice, una linea tra l'una e l'altra. */
export function RowList({ children, className, label }: { children: ReactNode; className?: string; label?: string }) {
  return (
    <ul aria-label={label} data-slot="row-list" className={cn("divide-y overflow-hidden rounded-xl border bg-card", className)}>
      {children}
    </ul>
  );
}

const TEXT_ACTION =
  "inline-flex min-h-11 items-center gap-0.5 rounded-md text-sm font-medium text-foreground underline decoration-foreground/40 underline-offset-4 outline-none hover:decoration-foreground focus-visible:ring-3 focus-visible:ring-ring/50 sm:min-h-8";

/**
 * Un'azione tranquilla con la freccia, «Tutti i numeri ›»: un link (`href`) o un pulsante della pagina (`onClick`).
 * Mai piena: il pieno è del prossimo passo.
 */
export function TextAction({ children, href, onClick, opensPanel, className }: { children: ReactNode; href?: string; onClick?: () => void; opensPanel?: boolean; className?: string }) {
  const body = (
    <>
      {children}
      <ChevronRight aria-hidden className="size-4" />
    </>
  );
  if (href) {
    return (
      <Link href={href} data-slot="text-action" className={cn(TEXT_ACTION, className)}>
        {body}
      </Link>
    );
  }
  return (
    <button type="button" onClick={onClick} aria-haspopup={opensPanel ? "dialog" : undefined} data-slot="text-action" className={cn(TEXT_ACTION, className)}>
      {body}
    </button>
  );
}
