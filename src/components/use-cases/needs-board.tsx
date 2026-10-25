import type { ReactNode } from "react";
import Link from "next/link";
import { DossierCardList, DossierReadOnlyNotice } from "@/components/uc/shell/case-card";
import { StatusDot } from "@/components/uc/ui/status-dot";
import type { DossierColumn } from "@/lib/db/queries/uc-nav";
import type { NeedAreaTable, NeedRow, NeedsBoard, NeedUseCaseRef, QuarterAsk } from "@/lib/use-cases/needs";
import { isBoardEmpty, needDoneSummaryText } from "@/lib/use-cases/needs";
import { cn } from "@/lib/utils";
import { Disclosure } from "./disclosure";

/** Testi di «Cosa serve» in Priorità (spec di Pierpaolo, 25/10/2026). */
export const NEEDS_BOARD_TEXT = Object.freeze({
  title: "Cosa serve",
  requirements: "Cosa serve per far avanzare gli use case",
  steps: "Prossimi passi",
  quarter: "Questo trimestre: cosa vi chiediamo, use case per use case",
  inProgress: "Use case in realizzazione",
  what: "Che cosa",
  who: "Chi",
  for: "Per",
  status: "Stato",
  due: "Entro",
  none: "—",
  empty: "Niente da chiedere per ora. Le esigenze si aggiungono dalla scheda di uno use case, nel capitolo «Cosa serve».",
  confirmBy: "Chi conferma i numeri",
  returns: "Il ritorno da confermare",
  now: "Ci serve subito",
  afterA8: "Dopo la scheda A.8",
  toDecide: "Da decidere",
  nothingToAsk: "Niente da chiedere per ora.",
});

export interface NeedsBoardViewProps {
  board: NeedsBoard;
  /** Le card dei dossier degli use case in realizzazione (`dossierColumnOf`), come nella Roadmap. */
  dossierColumn?: DossierColumn | null;
  /** id dello use case → il pannello laterale (`?apri=`). */
  hrefOf: (id: string) => string;
  className?: string;
}

/**
 * «Cosa serve» in fondo a Priorità, sempre, solo per i revisori (spec di Pierpaolo, 25/10/2026).
 * Quattro blocchi, ognuno solo se ha qualcosa:
 * 1. «Cosa serve per far avanzare gli use case»: una tabella per area (Accessi, Dati e documenti,
 *    Regole e decisioni, Persone e ruoli, Contratto e governance, Altro) con Che cosa, Chi, Per (i
 *    codici aprono il pannello), Stato ed Entro; le righe già a posto sono chiuse di default.
 * 2. «Prossimi passi», per mese; quelli fatti chiusi di default.
 * 3. «Questo trimestre: cosa vi chiediamo»: una scheda per use case approvato per il trimestre (anche
 *    se è già in realizzazione), con
 *    chi conferma, il ritorno da confermare, «Ci serve subito», «Dopo la scheda A.8», «Da decidere».
 * 4. Gli use case in realizzazione con il dossier: le card della colonna della Roadmap.
 * Sotto i 768 px le tabelle diventano elenchi. Nessun conteggio e nessun filtro per persona: «Chi»
 * è un testo della riga. Componente senza stato: si rende sul server.
 */
export function NeedsBoardView({ board, dossierColumn = null, hrefOf, className }: NeedsBoardViewProps) {
  const column = dossierColumn?.state === "pronta" && dossierColumn.cards.length ? dossierColumn : null;
  const empty = isBoardEmpty(board) && !column;
  return (
    <section aria-labelledby="cosa-serve-titolo" data-slot="needs-board" className={cn("space-y-6 border-t pt-6", className)}>
      <h2 id="cosa-serve-titolo" className="text-base font-semibold">
        {NEEDS_BOARD_TEXT.title}
      </h2>
      {empty ? <p className="text-sm text-muted-foreground">{NEEDS_BOARD_TEXT.empty}</p> : null}

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
              <h4 id={`cosa-serve-mese-${month.key}`} className="text-xs font-medium text-muted-foreground">
                {month.label}
              </h4>
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
        <Block id="cosa-serve-trimestre" title={NEEDS_BOARD_TEXT.quarter} slot="needs-quarter">
          <ul className="grid gap-3 lg:grid-cols-2">
            {board.quarter.map((ask) => (
              <QuarterCard key={ask.id} ask={ask} href={hrefOf(ask.id)} />
            ))}
          </ul>
        </Block>
      ) : null}

      {column ? (
        <Block id="cosa-serve-realizzazione" title={NEEDS_BOARD_TEXT.inProgress} slot="needs-in-progress">
          {column.readOnlyNotice ? <DossierReadOnlyNotice /> : null}
          <DossierCardList cards={column.cards} className="sm:grid-cols-2 lg:grid-cols-3" />
        </Block>
      ) : null}
    </section>
  );
}

function Block({ id, title, slot, children }: { id: string; title: string; slot: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} data-slot={slot} className="space-y-3">
      <h3 id={id} className="text-sm font-semibold">
        {title}
      </h3>
      {children}
    </section>
  );
}

/** I codici degli use case collegati, ognuno apre il pannello; senza codice il titolo. */
export function UseCaseCodes({ refs, forLabel, hrefOf }: { refs: readonly NeedUseCaseRef[]; forLabel: string | null; hrefOf: (id: string) => string }) {
  if (!refs.length) return <span className={forLabel ? undefined : "text-muted-foreground"}>{forLabel ?? NEEDS_BOARD_TEXT.none}</span>;
  return (
    <span className="inline-flex flex-wrap gap-x-2 gap-y-1">
      {refs.map((ref) => (
        <Link
          key={ref.id}
          href={hrefOf(ref.id)}
          scroll={false}
          title={ref.title}
          data-need-use-case={ref.id}
          className={cn(
            // Al telefono un bersaglio da dito (44 px di altezza); nelle tabelle da 768 px il testo basta.
            "inline-flex min-h-11 items-center rounded-sm text-primary underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50 md:min-h-0",
            ref.code ? "font-mono text-xs" : "line-clamp-1 text-sm",
          )}
        >
          {ref.code ?? ref.title}
        </Link>
      ))}
    </span>
  );
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
  return (
    <section aria-labelledby={headingId} data-need-area={area.key} className="space-y-2">
      <h4 id={headingId} className="text-xs font-medium text-muted-foreground">
        {area.label}
      </h4>
      {area.open.length ? <NeedTable rows={area.open} hrefOf={hrefOf} labelledBy={headingId} /> : null}
      {area.done.length ? (
        <Disclosure summary={needDoneSummaryText("requisito", area.done.length)} slot="needs-area-done">
          <NeedTable rows={area.done} hrefOf={hrefOf} labelledBy={headingId} />
        </Disclosure>
      ) : null}
    </section>
  );
}

/** Da 768 px una tabella; sotto, un elenco con le stesse cose (mai le due insieme a schermo). */
function NeedTable({ rows, hrefOf, labelledBy }: { rows: readonly NeedRow[]; hrefOf: (id: string) => string; labelledBy: string }) {
  return (
    <>
      <div className="hidden overflow-hidden rounded-lg border md:block">
        <table aria-labelledby={labelledBy} className="w-full table-fixed text-sm">
          <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
            <tr>
              <th scope="col" className="w-[40%] px-3 py-2 font-medium">
                {NEEDS_BOARD_TEXT.what}
              </th>
              <th scope="col" className="w-[18%] px-3 py-2 font-medium">
                {NEEDS_BOARD_TEXT.who}
              </th>
              <th scope="col" className="w-[16%] px-3 py-2 font-medium">
                {NEEDS_BOARD_TEXT.for}
              </th>
              <th scope="col" className="w-[14%] px-3 py-2 font-medium">
                {NEEDS_BOARD_TEXT.status}
              </th>
              <th scope="col" className="w-[12%] px-3 py-2 font-medium">
                {NEEDS_BOARD_TEXT.due}
              </th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows.map((row) => (
              <tr key={row.id} data-need={row.id} className="align-top">
                <td className="px-3 py-2">
                  <What row={row} />
                </td>
                <td className="px-3 py-2 break-words">{row.owner ?? <span className="text-muted-foreground">{NEEDS_BOARD_TEXT.none}</span>}</td>
                <td className="px-3 py-2">
                  <UseCaseCodes refs={row.useCases} forLabel={row.forLabel} hrefOf={hrefOf} />
                </td>
                <td className="px-3 py-2">
                  <StatusDot tone={row.status.tone} label={row.status.label} />
                </td>
                <td className="px-3 py-2">
                  <Due row={row} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul data-slot="needs-list" className="divide-y rounded-lg border md:hidden">
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

/** «Chi · Per · Entro» in una riga, per gli elenchi. */
function MetaLine({ row, hrefOf }: { row: NeedRow; hrefOf: (id: string) => string }) {
  const parts: ReactNode[] = [];
  if (row.owner) parts.push(<span key="chi">{row.owner}</span>);
  if (row.useCases.length || row.forLabel) parts.push(<UseCaseCodes key="per" refs={row.useCases} forLabel={row.forLabel} hrefOf={hrefOf} />);
  if (row.due) parts.push(<span key="entro" className="tabular-nums">{row.due}</span>);
  if (!parts.length) return null;
  return (
    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
      {parts.flatMap((part, index) => (index ? [<span key={`sep-${index}`} aria-hidden>·</span>, part] : [part]))}
    </p>
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
