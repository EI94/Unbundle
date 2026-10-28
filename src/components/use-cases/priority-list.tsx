import Link from "next/link";
import type { CostBandInfo } from "@/lib/use-cases/cost-bands";
import type { InfoProgressView } from "@/lib/use-cases/info-progress";
import { toDecisionItem } from "@/lib/use-cases/decision-ui";
import { hasValueText, priorityListColumns, showsZone, zoneText } from "@/lib/use-cases/format";
import { VALUE_COST_NOT_ESTIMATED_LABEL } from "@/lib/use-cases/labels";
import { isToEstimate, roadmapGroupKey, type HubItem } from "@/lib/use-cases/views";
import { cn } from "@/lib/utils";
import { CostFigure } from "./cost-figure";
import { InfoChip } from "./info-chip";
import { OriginChip } from "./origin-chip";
import { ExpiredTag } from "./roadmap-card";
import { panelHref, type HubQuery } from "./use-case-row";
import { MATRIX_TEXT, ToEstimateChip } from "./value-cost-matrix";
import { ValueFigure } from "./value-figure";
import { WhenControl } from "./when-control";

/** Intestazioni della lista (docs/use-case/DESIGN.md §4.4). */
export const PRIORITY_LIST_TEXT = Object.freeze({
  code: "Codice",
  title: "Titolo",
  origin: "Origine",
  value: "Valore",
  cost: "Costo",
  zone: "Zona",
  when: "Quando",
});

export interface PriorityListProps {
  workspaceId: string;
  /** Già in ordine: zona, Valore decrescente, Costo crescente; «da stimare» in fondo (`buildPriority`). */
  items: readonly HubItem[];
  today: string;
  canDecide: boolean;
  bands?: readonly CostBandInfo[];
  basePath: string;
  query: HubQuery;
  /**
   * La lista con `stima=mancante` (dal chip): tutte le righe. Senza, le righe «da stimare» stanno
   * in un chip solo, come nella matrice, che porta qui.
   */
  toEstimateHref: string;
  /**
   * «Raccolta informazioni» per scheda (id in minuscolo), solo per i revisori: il chip corto accanto
   * al titolo, solo «da verificare» e «senza risposta».
   */
  info?: Readonly<Record<string, InfoProgressView>> | null;
}

/** L'etichetta «Valore:» o «Costo:» dentro la cifra (il primo figlio) si nasconde quando ci sono le colonne. */
const HIDE_LABEL_WITH_COLUMNS = "@min-[58rem]/hub:[&>span:first-child]:hidden";

/**
 * Le colonne, quando il riquadro della pagina (`@container/hub` di hub.tsx) è largo almeno 58rem
 * (928 px): a 1280 px di finestra, accanto alla barra laterale, il riquadro ha 960 px (945 con una
 * barra di scorrimento classica). Codice, origine e zona hanno una larghezza fissa; titolo, Valore,
 * Costo e «Quando» si dividono il resto (2 : 1 : 1,5 : 1), mai sotto il loro minimo: a 58rem il
 * titolo ha circa 10rem e Valore e Costo vanno a capo («da misurare ·» / «fino a 5.840 €»), senza
 * uscire dalla colonna. Da 64rem «Quando» ha 11rem fisse: «Scaduto» sta accanto al trimestre, più
 * stretto va sotto. Nessuna misura dipende dal testo, così le righe (una griglia ciascuna) e le
 * intestazioni restano allineate.
 *
 * Quattro forme, per intero (Tailwind genera solo le classi scritte così nel sorgente): con e senza
 * la zona (senza quando nessuna riga la scrive, `showsZone`), con e senza l'origine (senza quando
 * tutte le righe hanno la stessa: la colonna ripeterebbe la stessa parola). Senza l'origine il
 * titolo prende il suo posto e non scende mai sotto 16rem.
 */
const COLUMNS = {
  origineZona:
    "@min-[58rem]/hub:grid @min-[58rem]/hub:grid-cols-[4.5rem_minmax(9rem,2fr)_8.25rem_minmax(7rem,1fr)_minmax(8.5rem,1.5fr)_7.25rem_minmax(6.5rem,1fr)] @5xl/hub:grid-cols-[4.5rem_minmax(9rem,2fr)_8.25rem_minmax(7rem,1fr)_minmax(8.5rem,1.5fr)_7.25rem_11rem] @min-[58rem]/hub:items-center @min-[58rem]/hub:gap-3",
  origine:
    "@min-[58rem]/hub:grid @min-[58rem]/hub:grid-cols-[4.5rem_minmax(9rem,2fr)_8.25rem_minmax(7rem,1fr)_minmax(8.5rem,1.5fr)_minmax(6.5rem,1fr)] @5xl/hub:grid-cols-[4.5rem_minmax(9rem,2fr)_8.25rem_minmax(7rem,1fr)_minmax(8.5rem,1.5fr)_11rem] @min-[58rem]/hub:items-center @min-[58rem]/hub:gap-3",
  zona: "@min-[58rem]/hub:grid @min-[58rem]/hub:grid-cols-[4.5rem_minmax(16rem,2fr)_minmax(7rem,1fr)_minmax(8.5rem,1.5fr)_7.25rem_minmax(6.5rem,1fr)] @5xl/hub:grid-cols-[4.5rem_minmax(16rem,2fr)_minmax(7rem,1fr)_minmax(8.5rem,1.5fr)_7.25rem_11rem] @min-[58rem]/hub:items-center @min-[58rem]/hub:gap-3",
  solo: "@min-[58rem]/hub:grid @min-[58rem]/hub:grid-cols-[4.5rem_minmax(16rem,2fr)_minmax(7rem,1fr)_minmax(8.5rem,1.5fr)_minmax(6.5rem,1fr)] @5xl/hub:grid-cols-[4.5rem_minmax(16rem,2fr)_minmax(7rem,1fr)_minmax(8.5rem,1.5fr)_11rem] @min-[58rem]/hub:items-center @min-[58rem]/hub:gap-3",
} as const;

/**
 * «Priorità › Da costruire» come lista (docs/use-case/DESIGN.md §4.4): codice, titolo, origine,
 * Valore, Costo con la fonte, zona e «Quando». La zona c'è solo per un Valore senza cifra in euro
 * (`showsZone`), la sua colonna solo se almeno una riga la scrive. «Quando», per i revisori: su
 * uno use case da decidere «Approva…», che apre il dialogo «Approva» con la scelta del trimestre
 * (nessuna approvazione silenziosa da un menu); su uno approvato un `Select` con il trimestre per
 * intero («T1 2027»), che cambia solo il trimestre, e il tag «Scaduto» se il trimestre è passato,
 * come nella Roadmap. Il titolo apre il pannello laterale. Con il riquadro sotto i 58rem ogni riga
 * va su due righe, senza scorrimento orizzontale.
 */
export function PriorityList({ workspaceId, items, today, canDecide, bands, basePath, query, toEstimateHref, info = null }: PriorityListProps) {
  // Come la matrice: le righe senza Valore o senza Costo in un chip «N da stimare», tranne nella
  // lista che il chip stesso apre (`stima=mancante`), dove sono tutte da stimare.
  const collapse = query.stima !== "mancante";
  const rows = collapse ? items.filter((item) => !isToEstimate(item)) : items;
  const toEstimate = items.length - rows.length;
  // La colonna «Zona» solo se almeno una riga scrive la zona (le altre righe hanno una cella vuota);
  // la colonna «Origine» solo se le righe non hanno tutte la stessa origine.
  const { origin: originColumn, zone: zoneColumn } = priorityListColumns(rows);
  const columns = originColumn ? (zoneColumn ? COLUMNS.origineZona : COLUMNS.origine) : zoneColumn ? COLUMNS.zona : COLUMNS.solo;
  return (
    <div data-slot="priority-list" className="space-y-1">
      {rows.length === 0 ? <p className="rounded-xl border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">{MATRIX_TEXT.allToEstimate}</p> : null}
      <div aria-hidden className={cn("hidden px-3 pb-1 text-xs font-medium text-muted-foreground", rows.length > 0 && columns)}>
        <span>{PRIORITY_LIST_TEXT.code}</span>
        <span>{PRIORITY_LIST_TEXT.title}</span>
        {originColumn ? <span>{PRIORITY_LIST_TEXT.origin}</span> : null}
        <span>{PRIORITY_LIST_TEXT.value}</span>
        <span>{PRIORITY_LIST_TEXT.cost}</span>
        {zoneColumn ? <span>{PRIORITY_LIST_TEXT.zone}</span> : null}
        <span>{PRIORITY_LIST_TEXT.when}</span>
      </div>
      <ul className="divide-y divide-border/70">
        {rows.map((item) => {
          const whenId = `quando-${item.id}`;
          const expired = item.phase === "approvato" && roadmapGroupKey(item.targetQuarter, today) === "scaduti";
          const estimated = !hasValueText(item.value) && !item.cost;
          return (
            <li key={item.id} data-slot="priority-row" data-id={item.id} className={cn("flex flex-col gap-2 px-3 py-2.5", columns)}>
              <span className="flex min-w-0 items-baseline gap-3 @min-[58rem]/hub:contents">
                {/* Sempre una cella, anche senza codice: le colonne restano allineate. */}
                <span className="shrink-0 font-mono text-xs text-muted-foreground tabular-nums empty:hidden @min-[58rem]/hub:empty:block">{item.code ?? ""}</span>
                {/*
                  Il titolo e, per i revisori, il chip di «Raccolta informazioni» sotto: una sola cella
                  della griglia, e il chip non toglie spazio al titolo.
                */}
                <span className="flex min-w-0 flex-col items-start gap-0.5">
                  <Link
                    href={panelHref(basePath, query, item.id)}
                    scroll={false}
                    title={item.title}
                    className="line-clamp-2 max-w-full min-w-0 text-sm font-semibold break-words text-foreground outline-none hover:underline focus-visible:underline @min-[58rem]/hub:line-clamp-1"
                  >
                    {item.title}
                  </Link>
                  <InfoChip view={info?.[item.id.toLowerCase()] ?? null} variant="short" className="max-w-full" />
                </span>
              </span>
              <span className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 @min-[58rem]/hub:contents">
                {/* Con le colonne l'origine c'è solo se le righe ne hanno più di una; nella riga stretta sempre. */}
                <span className={cn("min-w-0", !originColumn && "@min-[58rem]/hub:hidden")}>
                  <OriginChip origin={item.origin} />
                </span>
                {/* Senza le colonne non c'è la riga delle intestazioni: ogni cifra porta la sua etichetta; senza Valore né Costo un solo «da stimare» (H4p). */}
                {estimated ? (
                  <span data-figure="stima" data-estimated="true" className="text-sm text-muted-foreground @min-[58rem]/hub:hidden">
                    {VALUE_COST_NOT_ESTIMATED_LABEL}
                  </span>
                ) : null}
                <ValueFigure value={item.value} withLabel wrap className={cn(HIDE_LABEL_WITH_COLUMNS, estimated && "@max-[58rem]/hub:hidden")} />
                <CostFigure cost={item.cost} bands={bands} withLabel stack="colonne" className={cn(HIDE_LABEL_WITH_COLUMNS, estimated && "@max-[58rem]/hub:hidden")} />
                {/* La zona solo per un Valore senza euro; con la colonna, una cella vuota tiene le righe allineate. */}
                {showsZone(item.value) ? (
                  <span className={cn("text-sm", estimated && "@max-[58rem]/hub:hidden")}>
                    <span className="text-muted-foreground @min-[58rem]/hub:hidden">{PRIORITY_LIST_TEXT.zone}: </span>
                    <span className={item.zone ? "font-medium" : "text-muted-foreground"}>{zoneText(item.zone, item.value)}</span>
                  </span>
                ) : zoneColumn ? (
                  <span aria-hidden className="hidden @min-[58rem]/hub:block" />
                ) : null}
              </span>
              {/* «Scaduto» accanto al trimestre, o sotto se la colonna è stretta. */}
              <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                <span id={whenId} className="sr-only">
                  {PRIORITY_LIST_TEXT.when}
                </span>
                <WhenControl workspaceId={workspaceId} item={toDecisionItem(item)} today={today} canDecide={canDecide} variant="select" labelledBy={whenId} className="min-w-0" />
                {expired ? <ExpiredTag /> : null}
              </span>
            </li>
          );
        })}
      </ul>
      {toEstimate > 0 ? (
        <div className="px-3 pt-2">
          <ToEstimateChip count={toEstimate} href={toEstimateHref} />
        </div>
      ) : null}
    </div>
  );
}
