import Link from "next/link";
import type { CostBandInfo } from "@/lib/use-cases/cost-bands";
import type { InfoProgressView } from "@/lib/use-cases/info-progress";
import { formatMonthYear, perYearText } from "@/lib/use-cases/format";
import { EXPIRED_TAG, isContributorItem, type AnyHubItem, type HubItem } from "@/lib/use-cases/views";
import { cn } from "@/lib/utils";
import { CostFigure } from "./cost-figure";
import { InfoChip } from "./info-chip";
import { KindLabel } from "./kind-label";
import { OriginChip } from "./origin-chip";
import { PhasePill } from "./phase-pill";
import { CodeLabel, shownPhaseLabel, subStateText, visibleCode } from "./use-case-row";
import { ValueFigure } from "./value-figure";

/** In quale colonna della Roadmap sta la card (docs/use-case/DESIGN.md §4.5). */
export type RoadmapColumn = "prossimi" | "in_realizzazione" | "fatti";

export interface RoadmapCardProps {
  item: AnyHubItem;
  column: RoadmapColumn;
  /** Gruppo «Scaduti»: il tag rosso «Scaduto», solo per i revisori. */
  expired?: boolean;
  /** La lettura del dossier è in errore (§4.9): «In realizzazione» mostra solo fase e titolo. */
  dossierDown?: boolean;
  /** Apre il pannello laterale. */
  href: string;
  bands?: readonly CostBandInfo[];
  /** «Raccolta informazioni» (solo revisori): il chip corto sotto il titolo, solo «da verificare» e «senza risposta». */
  info?: InfoProgressView | null;
}

/**
 * Una card della Roadmap (docs/use-case/DESIGN.md §4.5), in sola lettura: un clic apre il
 * pannello laterale.
 * - Prossimi: codice, titolo, origine, il Valore (gli euro all'anno se ci sono, altrimenti in
 *   parola) e il costo nella forma corta con la fonte, la stessa della riga
 *   («€€ · 40.000 € · team»); le best practice con «Da diffondere», il Valore e senza costo;
 *   nel gruppo «Scaduti» il tag rosso «Scaduto». Una cifra da stimare dice quale è:
 *   «Valore: da stimare», «Costo: da stimare».
 * - In realizzazione: codice, titolo, origine e la fase con lo stato del dossier, oppure
 *   «Senza dossier»; con la lettura del dossier in errore solo la fase (§4.9). Il riepilogo
 *   del dossier (avanzamento, prossima tappa) arriva con H6a.
 * - Fatti: codice, titolo, «Realizzato» o «Diffusa», mese, valore annuo se c'è.
 * I contributori vedono titolo, fase e «Quando», nient'altro (nemmeno «Scaduto»); delle
 * proprie proposte anche il codice (D4, D13).
 */
export function RoadmapCard({ item, column, expired = false, dossierDown = false, href, bands, info = null }: RoadmapCardProps) {
  return (
    <li data-slot="roadmap-card" data-id={item.id}>
      <Link
        href={href}
        scroll={false}
        className="block space-y-2 rounded-xl border bg-card px-3 py-2.5 outline-none transition-colors hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <span className="flex min-w-0 items-baseline gap-2">
          <CodeLabel code={visibleCode(item)} />
          <span className="line-clamp-2 min-w-0 text-sm font-semibold text-foreground">{item.title}</span>
        </span>
        {isContributorItem(item) ? null : <InfoChip view={info} variant="short" className="flex" />}
        {isContributorItem(item) ? (
          <span className="flex flex-wrap items-center gap-2">
            <PhasePill label={shownPhaseLabel(item, dossierDown)} phase={item.phase} subState={item.subState} />
          </span>
        ) : (
          <ReviewerDetails item={item} column={column} expired={expired} dossierDown={dossierDown} bands={bands} />
        )}
      </Link>
    </li>
  );
}

/** Il tag rosso «Scaduto» (§4.5): trimestre passato, senza avvio. Lo stesso nella Roadmap e nella lista di «Priorità». */
export function ExpiredTag({ className }: { className?: string }) {
  return (
    <span
      data-slot="expired-tag"
      className={cn("inline-flex shrink-0 items-center rounded-full bg-red-500/15 px-2 py-0.5 text-xs font-medium whitespace-nowrap text-red-300", className)}
    >
      {EXPIRED_TAG}
    </span>
  );
}

function ReviewerDetails({
  item,
  column,
  expired,
  dossierDown,
  bands,
}: {
  item: HubItem;
  column: RoadmapColumn;
  expired: boolean;
  dossierDown: boolean;
  bands?: readonly CostBandInfo[];
}) {
  if (column === "in_realizzazione") {
    return (
      <span className="flex flex-wrap items-center gap-2">
        <OriginChip origin={item.origin} />
        <PhasePill label={shownPhaseLabel(item, dossierDown)} tone={item.tone} />
      </span>
    );
  }
  if (column === "fatti") {
    const month = item.realizedOn ? formatMonthYear(item.realizedOn) : null;
    const perYear = perYearText(item.value.perYear);
    return (
      <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
        <span className="font-medium text-foreground">
          {subStateText(item)}
          {month ? <span className="font-normal text-muted-foreground"> · {month}</span> : null}
        </span>
        {perYear ? (
          <span data-figure="valore" className="text-muted-foreground">
            {perYear}
          </span>
        ) : null}
      </span>
    );
  }
  const bestPractice = item.kind === "da_diffondere";
  return (
    <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <OriginChip origin={item.origin} />
      {bestPractice ? <KindLabel kind={item.kind} /> : null}
      <ValueFigure value={item.value} withLabel className="text-xs" />
      {bestPractice ? null : <CostFigure cost={item.cost} bands={bands} withLabel className="text-xs" />}
      {expired ? <ExpiredTag /> : null}
    </span>
  );
}
