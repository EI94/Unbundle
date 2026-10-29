import type { ReactNode } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { StatusDot } from "@/components/uc/ui/status-dot";
import type { NeedAreaTable, NeedRow, NeedsBoard, QuarterAsk } from "@/lib/use-cases/needs";
import { FIGURE_SEPARATOR } from "@/lib/use-cases/format";
import { isBoardEmpty, needDoneSummaryText, needForText, quarterAskSummaryText } from "@/lib/use-cases/needs";
import { cn } from "@/lib/utils";
import { Disclosure } from "./disclosure";
import { EmptyState, NoResults } from "./hub-header";
import { NeedUseCaseLink, NeedUseCasesDisclosure } from "./need-use-cases";
import { inRealizationText, PRIORITY_TEXT } from "./priority-view";

/** Testi della vista «Cosa serve» (spec di Pierpaolo, 25/10/2026; rilascio «Pulizia»). */
export const NEEDS_BOARD_TEXT = Object.freeze({
  requirements: "Requisiti",
  steps: "Prossimi passi",
  what: "Che cosa",
  who: "Chi",
  for: "Per",
  status: "Stato",
  due: "Entro",
  none: "—",
  emptyTitle: "Niente da chiedere per ora",
  emptyBody: "Le esigenze si aggiungono dalla scheda di uno use case, nel capitolo «Cosa serve».",
  noResults: "Niente da chiedere con questi filtri.",
  confirmBy: "Chi conferma i numeri",
  returns: "Il ritorno da confermare",
  now: "Ci serve subito",
  afterA8: "Dopo la scheda A.8",
  toDecide: "Da decidere",
  nothingToAsk: "Niente da chiedere per ora.",
});

export interface NeedsBoardViewProps {
  board: NeedsBoard;
  /** id dello use case → il pannello laterale (`?apri=`). */
  hrefOf: (id: string) => string;
  /** Quanti use case (filtrati) sono in realizzazione: i loro dossier stanno nella Roadmap. */
  inRealization?: number;
  /** La Roadmap, per «Vai alla Roadmap». */
  roadmapHref?: string | null;
  /** Con un filtro attivo il vuoto è «Niente da chiedere con questi filtri.» [Togli i filtri]. */
  filtersActive?: boolean;
  clearHref?: string;
}

/**
 * La vista «Cosa serve», solo per i revisori (spec di Pierpaolo, 25/10/2026; rilascio «Pulizia»).
 * Due blocchi aperti, ognuno solo se ha qualcosa, poi le schede del trimestre, chiuse:
 * 1. «Requisiti»: una tabella per area (Accessi, Dati e documenti, Regole e decisioni, Persone e
 *    ruoli, Contratto e governance, Altro) con Che cosa, Chi, Per, Stato ed Entro; le righe già a
 *    posto sono chiuse di default.
 * 2. «Prossimi passi», per mese; quelli fatti chiusi di default.
 * 3. «Cosa vi chiediamo questo trimestre», chiuso di default: una scheda per use case approvato per
 *    il trimestre (anche se è già in realizzazione), con chi conferma, il ritorno da confermare,
 *    «Ci serve subito», «Dopo la scheda A.8», «Da decidere».
 * I dossier degli use case in realizzazione stanno nella Roadmap: qui solo una riga con il link.
 * «Per»: uno use case si legge per intero, più di uno dietro «Per N use case»; ognuno apre il
 * pannello. Nessun titolo visibile: la scheda attiva del selettore nomina la vista. Sotto i 56rem
 * del riquadro le tabelle diventano elenchi. Nessun conteggio e nessun filtro per persona: «Chi» è
 * un testo della riga. Componente senza stato: si rende sul server.
 */
export function NeedsBoardView({ board, hrefOf, inRealization = 0, roadmapHref = null, filtersActive = false, clearHref }: NeedsBoardViewProps) {
  const toRoadmap = inRealization > 0 && roadmapHref ? roadmapHref : null;
  if (isBoardEmpty(board)) {
    return (
      <div data-slot="needs-board">
        {filtersActive && clearHref ? (
          <NoResults clearHref={clearHref} title={NEEDS_BOARD_TEXT.noResults} />
        ) : (
          <EmptyState title={NEEDS_BOARD_TEXT.emptyTitle} body={toRoadmap ? inRealizationText(inRealization) : NEEDS_BOARD_TEXT.emptyBody}>
            {toRoadmap ? (
              <Button variant="outline" className="min-h-11 sm:min-h-8" render={<Link href={toRoadmap} scroll={false} />} nativeButton={false}>
                {PRIORITY_TEXT.goToRoadmap}
              </Button>
            ) : null}
          </EmptyState>
        )}
      </div>
    );
  }
  return (
    <div data-slot="needs-board" className="space-y-8">
      {board.areas.length ? (
        <Block id="cosa-serve-requisiti" title={NEEDS_BOARD_TEXT.requirements} slot="needs-requirements">
          {board.areas.map((area) => (
            <AreaTable key={area.key} area={area} hrefOf={hrefOf} />
          ))}
        </Block>
      ) : null}

      {board.steps.length || board.stepsDone.length ? (
        <Block id="cosa-serve-passi" title={NEEDS_BOARD_TEXT.steps} slot="needs-steps">
          {board.steps.map((month) => (
            <section key={month.key} aria-labelledby={`cosa-serve-mese-${month.key}`} className="space-y-2">
              <h3 id={`cosa-serve-mese-${month.key}`} className="text-xs font-medium text-muted-foreground">
                {month.label}
              </h3>
              <StepList rows={month.rows} hrefOf={hrefOf} />
            </section>
          ))}
          {board.stepsDone.length ? (
            <Disclosure summary={needDoneSummaryText("passo", board.stepsDone.length)} slot="needs-steps-done">
              <StepList rows={board.stepsDone} hrefOf={hrefOf} />
            </Disclosure>
          ) : null}
        </Block>
      ) : null}

      {board.quarter.length ? (
        <Disclosure summary={quarterAskSummaryText(board.quarter.length)} slot="needs-quarter">
          <ul className="grid gap-3 @4xl/hub:grid-cols-2">
            {board.quarter.map((ask) => (
              <QuarterCard key={ask.id} ask={ask} href={hrefOf(ask.id)} />
            ))}
          </ul>
        </Disclosure>
      ) : null}

      {toRoadmap ? (
        <p data-slot="needs-in-progress" className="text-sm text-muted-foreground">
          {inRealizationText(inRealization)}{" "}
          <Link
            href={toRoadmap}
            scroll={false}
            className="rounded-sm font-medium text-primary underline underline-offset-4 outline-none hover:decoration-2 focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            {PRIORITY_TEXT.goToRoadmap}
          </Link>
        </p>
      ) : null}
    </div>
  );
}

function Block({ id, title, slot, children }: { id: string; title: string; slot: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} data-slot={slot} className="space-y-3">
      <h2 id={id} className="text-sm font-semibold">
        {title}
      </h2>
      {children}
    </section>
  );
}

/**
 * «Per» di una riga: senza use case collegati il testo libero (o «—»); con uno solo il suo link,
 * «TJ-0012 · Smistamento»; con più di uno «Per N use case», chiuso, che si apre sui link. Ogni link
 * apre il pannello.
 */
function NeedFor({ row, hrefOf }: { row: NeedRow; hrefOf: (id: string) => string }) {
  if (!row.useCases.length) return <span className={row.forLabel ? undefined : "text-muted-foreground"}>{row.forLabel ?? NEEDS_BOARD_TEXT.none}</span>;
  if (row.useCases.length === 1) return <NeedUseCaseLink useCase={row.useCases[0]} href={hrefOf(row.useCases[0].id)} scroll={false} />;
  return <NeedUseCasesDisclosure summary={needForText(row.useCases.length)} context={row.title} useCases={row.useCases} hrefOf={hrefOf} scroll={false} />;
}

function What({ row }: { row: NeedRow }) {
  return (
    <div className="min-w-0">
      <p className="text-sm font-medium break-words">{row.title}</p>
      {row.detail ? <p className="line-clamp-2 text-xs text-muted-foreground break-words">{row.detail}</p> : null}
    </div>
  );
}

function Due({ row }: { row: NeedRow }) {
  return <span className={cn("tabular-nums", row.due ? undefined : "text-muted-foreground")}>{row.due ?? NEEDS_BOARD_TEXT.none}</span>;
}

function AreaTable({ area, hrefOf }: { area: NeedAreaTable; hrefOf: (id: string) => string }) {
  const headingId = `cosa-serve-area-${area.key}`;
  // «Entro» solo se una riga dell'area ha una data: una colonna di «—» non dice niente. La stessa
  // scelta per le righe aperte e quelle a posto, così le due tabelle hanno le stesse colonne.
  const withDue = [...area.open, ...area.done].some((row) => row.due);
  return (
    <section aria-labelledby={headingId} data-need-area={area.key} className="space-y-2">
      <h3 id={headingId} className="text-xs font-medium text-muted-foreground">
        {area.label}
      </h3>
      {area.open.length ? <NeedTable rows={area.open} hrefOf={hrefOf} labelledBy={headingId} withDue={withDue} /> : null}
      {area.done.length ? (
        <Disclosure summary={needDoneSummaryText("requisito", area.done.length)} slot="needs-area-done">
          <NeedTable rows={area.done} hrefOf={hrefOf} labelledBy={headingId} withDue={withDue} />
        </Disclosure>
      ) : null}
    </section>
  );
}

/**
 * Una tabella quando il riquadro della pagina (`@container/hub` di hub.tsx) è largo almeno 56rem;
 * più stretto un elenco con le stesse cose (mai le due insieme a schermo). Sulla larghezza della
 * finestra (768 px) la tabella aveva circa 460 px accanto alla barra laterale: Stato ed Entro
 * restavano tagliati. «Per» ha un quinto della riga o più: aperto, «Per 6 use case» elenca i
 * codici e i titoli senza tagliarli dopo poche parole. Senza date nell'area, niente «Entro» e
 * le altre colonne si allargano.
 */
function NeedTable({ rows, hrefOf, labelledBy, withDue = true }: { rows: readonly NeedRow[]; hrefOf: (id: string) => string; labelledBy: string; withDue?: boolean }) {
  return (
    <>
      <div className="hidden overflow-hidden rounded-lg border @4xl/hub:block">
        <table aria-labelledby={labelledBy} className="w-full table-fixed text-sm">
          <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
            <tr>
              <th scope="col" className={cn(withDue ? "w-[36%]" : "w-[42%]", "px-3 py-2 font-medium")}>
                {NEEDS_BOARD_TEXT.what}
              </th>
              <th scope="col" className={cn(withDue ? "w-[16%]" : "w-[18%]", "px-3 py-2 font-medium")}>
                {NEEDS_BOARD_TEXT.who}
              </th>
              <th scope="col" className={cn(withDue ? "w-[22%]" : "w-[26%]", "px-3 py-2 font-medium")}>
                {NEEDS_BOARD_TEXT.for}
              </th>
              <th scope="col" className="w-[14%] px-3 py-2 font-medium">
                {NEEDS_BOARD_TEXT.status}
              </th>
              {withDue ? (
                <th scope="col" className="w-[12%] px-3 py-2 font-medium">
                  {NEEDS_BOARD_TEXT.due}
                </th>
              ) : null}
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows.map((row) => (
              <tr key={row.id} data-need={row.id} className="align-top">
                <td className="px-3 py-2">
                  <What row={row} />
                </td>
                <td className="px-3 py-2 break-words">{row.owner ? <OwnerText text={row.owner} /> : <span className="text-muted-foreground">{NEEDS_BOARD_TEXT.none}</span>}</td>
                <td className="px-3 py-2">
                  <NeedFor row={row} hrefOf={hrefOf} />
                </td>
                <td className="px-3 py-2">
                  <StatusDot tone={row.status.tone} label={row.status.label} />
                </td>
                {withDue ? (
                  <td className="px-3 py-2">
                    <Due row={row} />
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul data-slot="needs-list" className="divide-y rounded-lg border @4xl/hub:hidden">
        {rows.map((row) => (
          <li key={row.id} data-need-item={row.id} className="space-y-1.5 px-3 py-2.5">
            <div className="flex items-start justify-between gap-3">
              <What row={row} />
              <StatusDot tone={row.status.tone} label={row.status.label} className="shrink-0" />
            </div>
            <MetaLine row={row} hrefOf={hrefOf} />
          </li>
        ))}
      </ul>
    </>
  );
}

/**
 * «Sistemi informativi · Cliente» nella colonna stretta «Chi»: il «·» va a capo con la parte che lo
 * segue («Sistemi informativi» / «· Cliente»), mai da solo in fondo alla riga. Lo stesso testo.
 */
function OwnerText({ text }: { text: string }) {
  const [first, ...rest] = text.split(FIGURE_SEPARATOR);
  return (
    <>
      {first}
      {rest.map((part, index) => (
        <span key={index}>
          {" "}
          <span className="whitespace-nowrap">{`${FIGURE_SEPARATOR.trim()} ${part}`}</span>
        </span>
      ))}
    </>
  );
}

/**
 * «Chi · Entro · Per» sotto il titolo, per gli elenchi. Ogni « · » va a capo con la parte che lo
 * segue, mai da solo in fondo alla riga. Il link a un solo use case («TJ-0008 · ATLAS A1 · …») sta
 * su una riga sua: è lungo, ha già i suoi « · », e in mezzo alla riga grigia non si capirebbe dove
 * inizia. «Per 3 use case» chiude la riga senza «·» e, aperto, va a capo da solo. Un `<div>`, non
 * un `<p>`: un `<details>` non è testo e dentro un `<p>` il parser spezzerebbe il DOM.
 */
function MetaLine({ row, hrefOf }: { row: NeedRow; hrefOf: (id: string) => string }) {
  const parts: Array<{ key: string; node: ReactNode }> = [];
  if (row.owner) parts.push({ key: "chi", node: row.owner });
  if (row.due) parts.push({ key: "entro", node: <span className="tabular-nums">{row.due}</span> });
  if (!row.useCases.length && row.forLabel) parts.push({ key: "per", node: <NeedFor row={row} hrefOf={hrefOf} /> });
  const one = row.useCases.length === 1;
  const several = row.useCases.length > 1;
  if (!parts.length && !one && !several) return null;
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
      {parts.map((part, index) => (
        <span key={part.key} data-meta={part.key} className="inline-flex min-w-0 items-center gap-x-2">
          {index ? <span aria-hidden>·</span> : null}
          <span className="min-w-0">{part.node}</span>
        </span>
      ))}
      {one ? (
        <span data-meta="per" className="flex min-w-0 basis-full">
          <NeedFor row={row} hrefOf={hrefOf} />
        </span>
      ) : null}
      {several ? <NeedFor row={row} hrefOf={hrefOf} /> : null}
    </div>
  );
}

function StepList({ rows, hrefOf }: { rows: readonly NeedRow[]; hrefOf: (id: string) => string }) {
  return (
    <ul className="divide-y rounded-lg border">
      {rows.map((row) => (
        <li key={row.id} data-need={row.id} className="space-y-1.5 px-3 py-2.5">
          <div className="flex items-start justify-between gap-3">
            <What row={row} />
            <StatusDot tone={row.status.tone} label={row.status.label} className="shrink-0" />
          </div>
          <MetaLine row={row} hrefOf={hrefOf} />
        </li>
      ))}
    </ul>
  );
}

function AskList({ title, rows }: { title: string; rows: readonly NeedRow[] }) {
  if (!rows.length) return null;
  return (
    <div className="space-y-1">
      <p className="text-xs font-medium text-muted-foreground">{title}</p>
      <ul className="space-y-1 text-sm">
        {rows.map((row) => (
          <li key={row.id} data-need={row.id} className="flex flex-wrap items-baseline gap-x-2">
            <span className="break-words">{row.title}</span>
            {row.owner || row.due ? (
              <span className="text-xs text-muted-foreground">{[row.owner, row.due].filter(Boolean).join(" · ")}</span>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

function QuarterCard({ ask, href }: { ask: QuarterAsk; href: string }) {
  const nothing = !ask.returns.length && !ask.now.length && !ask.afterA8.length && !ask.toDecide.length;
  return (
    <li data-quarter-ask={ask.id} className="min-w-0 space-y-3 rounded-xl border bg-card p-4">
      <div className="space-y-1">
        <Link href={href} scroll={false} className="line-clamp-2 rounded-sm text-sm font-semibold break-words outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50">
          {ask.code ? (
            <>
              <span className="font-mono font-medium">{ask.code}</span>
              <span className="text-muted-foreground"> · </span>
            </>
          ) : null}
          {ask.title}
        </Link>
        {ask.confirmBy ? (
          <p className="text-xs text-muted-foreground">
            {NEEDS_BOARD_TEXT.confirmBy}: <span className="text-foreground">{ask.confirmBy}</span>
          </p>
        ) : null}
      </div>
      {ask.returns.length ? (
        <div className="space-y-1">
          <p className="text-xs font-medium text-muted-foreground">{NEEDS_BOARD_TEXT.returns}</p>
          <ul className="space-y-1 text-sm">
            {ask.returns.map((line) => (
              <li key={line.key} data-return={line.key}>
                <span className="font-medium">{line.label}</span>
                <span className="text-muted-foreground"> · {line.confidence.toLowerCase()}</span>
                <span className="block text-xs text-muted-foreground tabular-nums">{line.text}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <AskList title={NEEDS_BOARD_TEXT.now} rows={ask.now} />
      <AskList title={NEEDS_BOARD_TEXT.afterA8} rows={ask.afterA8} />
      <AskList title={NEEDS_BOARD_TEXT.toDecide} rows={ask.toDecide} />
      {nothing ? <p className="text-sm text-muted-foreground">{NEEDS_BOARD_TEXT.nothingToAsk}</p> : null}
    </li>
  );
}
