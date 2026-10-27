import type { InfoProgressView } from "@/lib/use-cases/info-progress";
import { INFO_PROGRESS_TEXT } from "@/lib/use-cases/info-progress";
import { cn } from "@/lib/utils";
import { InfoChip } from "../info-chip";

/**
 * In cima a «Cosa serve» (SPEC §P2.10.4): «Raccolta informazioni», lo stato della scheda e «N di M
 * informazioni ricevute» (esigenze della scheda, mai persone), poi una frase su cosa fare. Una riga
 * da `md`, due sotto. Niente barra di avanzamento, nessun numero per persona.
 */
export function InfoSummary({ view, className }: { view: InfoProgressView | null | undefined; className?: string }) {
  if (!view) return null;
  return (
    <div data-slot="info-summary" data-state={view.state} className={cn("space-y-1", className)}>
      <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{INFO_PROGRESS_TEXT.summaryHeading}</h3>
      <p className="flex min-w-0 flex-col gap-1 md:flex-row md:flex-wrap md:items-center md:gap-x-4">
        <InfoChip view={view} variant="long" />
        <span data-slot="info-count" className="text-xs text-muted-foreground">
          {view.count}
        </span>
      </p>
      {view.hint ? <p className="text-sm break-words text-muted-foreground">{view.hint}</p> : null}
    </div>
  );
}
