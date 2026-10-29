import type { ReactNode } from "react";
import Link from "next/link";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ActivityMappingState } from "@/lib/use-cases/create";
import { cn } from "@/lib/utils";
import { HubMenu, type HubMenuLink } from "./hub-menu";

/** Testi della testata e dei vuoti della pagina (docs/use-case/DESIGN.md §4.1, §4.9, §5.5, §14.3). */
export const HUB_TEXT = Object.freeze({
  title: "Use case",
  subtitle: "Dal basso e dall'alto: quali use case realizzare e quando.",
  newUseCase: "Nuovo use case",
  viewsLabel: "Viste",
  /** La prima vista, per tutti (rilascio «Panoramica»): al posto di «Priorità» e «Roadmap». */
  overviewView: "Panoramica",
  decideView: "Da decidere",
  /** La stessa vista per i contributori, che non decidono: niente contatore (H4p). */
  contributorDecideView: "In valutazione",
  goToOverview: "Vai alla Panoramica",
  /** Sopra un grafico del menu «⋯». */
  backToOverview: "Torna alla Panoramica",
  /** La voce del menu «⋯» e il titolo del grafico. */
  curve: "Curva del valore",
  emptyTitle: "Nessuno use case, per ora",
  emptyReviewer: "Aggiungine uno o proponili da Activity mapping.",
  emptyContributor: "Proponi il primo use case.",
  noResults: "Nessuno use case con questi filtri.",
  clearFilters: "Togli i filtri",
  receiptTitle: "Grazie! Use case inviato.",
});

/** «Il codice è XX-0012. {teamName} lo valuta: la fase la trovi qui.» (§5.5; il nome del team da solo, §14.2). */
export function receiptText(code: string | null, teamName: string): string {
  const evaluates = `${teamName} lo valuta: la fase la trovi qui.`;
  return code ? `Il codice è ${code}. ${evaluates}` : evaluates;
}

/** «1 use case è già in realizzazione» · «3 use case sono già in realizzazione»: li mostra la Panoramica, nella sezione «In realizzazione». */
export function inRealizationText(count: number): string {
  return count === 1 ? "1 use case è già in realizzazione." : `${count} use case sono già in realizzazione.`;
}

export interface HubHeaderProps {
  workspaceId: string;
  /** Dove porta «Nuovo use case»: il pannello rapido (Lateral Space) o il modulo completo. */
  newHref: string;
  /** Menu «⋯», solo revisori (§4.1): i grafici (matrici e curva del valore), «Esporta Excel», «Proponi da Activity mapping»; senza, non c'è. */
  menu: { exportHref: string; activityMapping: ActivityMappingState; mappingHref: string; charts: readonly HubMenuLink[] } | null;
  children?: ReactNode;
}

/**
 * La testata della pagina (docs/use-case/DESIGN.md §4.1): H1 «Use case», il sottotitolo di una
 * riga, il solo pulsante pieno «Nuovo use case» (pannello rapido per Lateral Space, modulo
 * completo per gli altri, §5.1) e il menu «⋯» dei revisori. Sotto, le viste e i filtri.
 */
export function HubHeader({ workspaceId, newHref, menu, children }: HubHeaderProps) {
  return (
    <header data-slot="hub-header" className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
        <div className="min-w-0 space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">{HUB_TEXT.title}</h1>
          <p className="text-sm text-muted-foreground">{HUB_TEXT.subtitle}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button className="min-h-11 sm:min-h-8" render={<Link href={newHref} scroll={false} />} nativeButton={false}>
            <Plus aria-hidden />
            {HUB_TEXT.newUseCase}
          </Button>
          {menu ? (
            <HubMenu workspaceId={workspaceId} charts={menu.charts} exportHref={menu.exportHref} activityMapping={menu.activityMapping} mappingHref={menu.mappingHref} />
          ) : null}
        </div>
      </div>
      {children}
    </header>
  );
}

/** Un vuoto della pagina: titolo, una riga e, se serve, un'azione (mai un secondo pulsante pieno). */
export function EmptyState({ title, body, children, className }: { title: string; body?: string | null; children?: ReactNode; className?: string }) {
  return (
    <div data-slot="hub-empty" className={cn("flex flex-col items-center gap-2 rounded-xl border border-dashed px-6 py-12 text-center", className)}>
      <p className="font-medium">{title}</p>
      {body ? <p className="max-w-md text-sm text-muted-foreground">{body}</p> : null}
      {children ? <div className="mt-2 flex flex-wrap items-center justify-center gap-2">{children}</div> : null}
    </div>
  );
}

/** «Nessuno use case con questi filtri.» [Togli i filtri] (§4.9); `title` per un'altra vista, come «Cosa serve». */
export function NoResults({ clearHref, title = HUB_TEXT.noResults }: { clearHref: string; title?: string }) {
  return (
    <EmptyState title={title}>
      <Button variant="outline" className="min-h-11 sm:min-h-8" render={<Link href={clearHref} scroll={false} />} nativeButton={false}>
        {HUB_TEXT.clearFilters}
      </Button>
    </EmptyState>
  );
}

/** Un avviso in cima alla pagina: la ricevuta (§5.5) o il benvenuto dopo un invito. */
export function HubNotice({ tone, title, children, testId }: { tone: "verde" | "blu"; title?: string; children: ReactNode; testId?: string }) {
  return (
    <div
      role="status"
      data-testid={testId}
      className={cn(
        "space-y-1 rounded-xl border p-4 text-sm",
        tone === "verde" ? "border-emerald-500/30 bg-emerald-500/5" : "border-sky-500/30 bg-sky-500/5",
      )}
    >
      {title ? <p className="font-medium">{title}</p> : null}
      <div className="text-muted-foreground">{children}</div>
    </div>
  );
}
