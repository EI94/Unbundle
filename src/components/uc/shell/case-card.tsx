import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/uc/ui/empty-state";
import { ProgressToGate } from "@/components/uc/ui/progress-to-gate";
import { StatusDot } from "@/components/uc/ui/status-dot";
import { cn } from "@/lib/utils";
import { REALIZATION_TEXT, type DossierCardView } from "@/lib/uc/views/realization";

/**
 * La card di un dossier in realizzazione (DESIGN §3.1): colonna «In
 * realizzazione» della Roadmap nella pagina Use case e lista di ripiego
 * `/casi-duso`. Tutta un link: codice e titolo dello use case, stato del
 * dossier, l'unico numero di avanzamento e una riga di contesto («Tocca a te ·
 * <passo>» oppure la prossima tappa). Il link porta al dossier per chi lo apre,
 * alla scheda dello use case per gli altri revisori.
 *
 * Riceve i dati come props (`casesForUseCases`, `dossierCardsForWorkspace` di
 * `uc-nav.ts`): nessuna lettura qui. Niente template, versione, «% verde» né
 * «G1».
 */
export function DossierCard({ card, className }: { card: DossierCardView; className?: string }) {
  const body = (
    <>
      <p className="line-clamp-2 text-sm font-semibold break-words">
        {card.code && (
          <>
            <span className="font-mono font-medium">{card.code}</span>
            <span className="text-muted-foreground"> · </span>
          </>
        )}
        {card.title}
      </p>
      <StatusDot tone={card.statusTone} label={card.statusLabel} />
      {card.progress && <ProgressToGate size="sm" ok={card.progress.ok} required={card.progress.required} inReview={card.progress.inReview} />}
      {(card.context || card.href) && (
        <p className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
          <span className={cn("min-w-0 flex-1 truncate", card.context?.kind === "turno" && "font-medium text-foreground")}>{card.context?.text ?? ""}</span>
          {card.href && <ChevronRight className="size-4 shrink-0" aria-hidden />}
        </p>
      )}
    </>
  );
  const frame = "flex min-w-0 flex-col gap-2.5 rounded-xl bg-card p-5 ring-1 ring-foreground/10";
  if (!card.href) {
    return (
      <div data-slot="dossier-card" className={cn(frame, className)}>
        {body}
      </div>
    );
  }
  return (
    <Link
      href={card.href}
      data-slot="dossier-card"
      className={cn(frame, "transition-shadow hover:ring-foreground/20 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none", className)}
    >
      {body}
    </Link>
  );
}

/** Le card una per riga, nell'ordine ricevuto (prima quelle in cui tocca a chi guarda). */
export function DossierCardList({ cards, className }: { cards: readonly DossierCardView[]; className?: string }) {
  return (
    <ul className={cn("grid min-w-0 gap-3", className)}>
      {cards.map((card) => (
        <li key={card.caseId} className="min-w-0">
          <DossierCard card={card} className="h-full" />
        </li>
      ))}
    </ul>
  );
}

/** Caricamento della colonna: due card `Skeleton`. */
export function DossierCardSkeleton() {
  return (
    <div className="grid min-w-0 gap-3" aria-hidden>
      {[0, 1].map((i) => (
        <div key={i} className="space-y-3 rounded-xl bg-card p-5 ring-1 ring-foreground/10">
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-3 w-28" />
          <Skeleton className="h-1.5 w-full" />
          <Skeleton className="h-3 w-1/2" />
        </div>
      ))}
    </div>
  );
}

/** Colonna vuota: «Ancora nulla in realizzazione». */
export function DossierColumnEmpty({ variant = "inline" }: { variant?: "inline" | "page" }) {
  return (
    <EmptyState variant={variant} title={REALIZATION_TEXT.emptyTitle}>
      {REALIZATION_TEXT.emptyBody}
    </EmptyState>
  );
}

/** Sola lettura: una volta sopra la colonna, solo per chi gestisce il workspace. */
export function DossierReadOnlyNotice() {
  return <p className="rounded-lg bg-uc-giallo-bg p-3 text-sm text-foreground">{REALIZATION_TEXT.readOnly}</p>;
}
