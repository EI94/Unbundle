import type { ReactNode } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { StatusDot } from "@/components/uc/ui/status-dot";
import { agentToneOf, type AgentPalette } from "@/lib/use-cases/agents";
import type { NeedAreaTable, NeedRow, NeedStepMonth, NeedsBoard, QuarterAsk } from "@/lib/use-cases/needs";
import { SCREEN_SEPARATOR, joinPieces, keepTogether, wholePiece } from "@/lib/use-cases/line-breaks";
import {
  isBoardEmpty,
  needAgents,
  needAskPieces,
  needDoneSummaryText,
  needForText,
  needStepsLaterText,
  needStepsUndatedText,
  needsSummaryPieces,
  quarterAskSummaryText,
  stepsHorizon,
} from "@/lib/use-cases/needs";
import { cn } from "@/lib/utils";
import { AgentTag } from "./agent-tag";
import { Disclosure } from "./disclosure";
import { EmptyState, HUB_TEXT, NoResults, inRealizationText } from "./hub-header";
import { HashFocusLink } from "./list-focus";
import { NeedUseCaseLink, NeedUseCasesDisclosure } from "./need-use-cases";

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
  /** Oggi (AAAA-MM-GG, Roma): aperti i mesi di «Prossimi passi» fino a quello di oggi, gli scaduti compresi. */
  today: string;
  /** I colori degli agenti del workspace (`workspaceAgentPalette`): gli stessi delle corsie. */
  agents?: AgentPalette | null;
  /** id dello use case → il pannello laterale (`?apri=`). */
  hrefOf: (id: string) => string;
  /** Quanti use case (filtrati) sono in realizzazione: i loro dossier stanno nella Panoramica. */
  inRealization?: number;
  /** La sezione «In realizzazione» della Panoramica, per «Vai alla Panoramica»: un'ancora che prende il fuoco (`HashFocusLink`). */
  realizationHref?: string | null;
  /** Con un filtro attivo il vuoto è «Niente da chiedere con questi filtri.» [Togli i filtri]. */
  filtersActive?: boolean;
  clearHref?: string;
  /**
   * Con una ricerca (`?q=`) le aree sono aperte: si legge subito quello che si cerca. Gli altri
   * filtri, anche il «Trimestre» di «Prossimo passo», le lasciano chiuse con i loro conteggi.
   */
  searched?: boolean;
  /** Il trimestre del filtro («T4 2026», «Più avanti»): in testa alla riga dei conteggi; null senza. */
  quarter?: string | null;
}

/**
 * La vista «Cosa serve», solo per i revisori e in sola lettura (spec di Pierpaolo, 25/10/2026;
 * rilascio «Panoramica», 29/10/2026: più leggera, ogni richiesta una volta sola). Due blocchi,
 * «Prossimi passi» solo se ha qualcosa, poi le schede del trimestre, chiuse:
 * 1. «Requisiti»: sotto il titolo la riga dei conteggi («86 aperti · 60 da chiedere · …»), poi una
 *    riga chiusa per area (Accessi, Dati e documenti, Regole e decisioni, Persone e ruoli, Contratto
 *    e governance, Altro) con i suoi conteggi, che si apre sulla sua tabella: Che cosa, Chi, Per,
 *    Stato ed Entro, con le righe già a posto chiuse. Con una ricerca le aree sono aperte; con il
 *    filtro «Trimestre» la riga dei conteggi comincia dal trimestre («T4 2026 · 67 aperti · …»).
 *    Senza requisiti, «Niente da chiedere per ora.» (o «… con questi filtri.»).
 * 2. «Prossimi passi»: aperti i mesi fino a quello di oggi (gli scaduti compresi), poi «Più avanti»
 *    e «Senza data», chiusi; quelli fatti chiusi.
 * 3. «Cosa vi chiediamo questo trimestre», chiuso di default: una scheda per use case approvato per
 *    il trimestre (anche se è già in realizzazione), con chi conferma, il ritorno da confermare,
 *    «Ci serve subito», «Dopo la scheda A.8», «Da decidere».
 * Gli use case in realizzazione stanno nella Panoramica: qui solo una riga con il link alla sua
 * sezione «In realizzazione». «Per»: lo use case per intero, che dice già il suo agente, o più di
 * uno dietro «Per N use case», con prima gli agenti serviti, letti dai titoli («LIBRA», «ORSA»);
 * ognuno apre il pannello. Le
 * richieste di un agente si leggono con il filtro «Agente». Nessun titolo visibile: la scheda attiva
 * del selettore nomina la vista. Sotto i 56rem del riquadro le tabelle diventano elenchi. Si conta
 * solo per stato, mai per persona: «Chi» è un testo della riga, mai contato né filtrato. Le
 * esigenze si cambiano nella scheda dello use case. Componente senza stato: si rende sul server.
 */
export function NeedsBoardView({
  board,
  today,
  agents = null,
  hrefOf,
  inRealization = 0,
  realizationHref = null,
  filtersActive = false,
  clearHref,
  searched = false,
  quarter = null,
}: NeedsBoardViewProps) {
  const toRealization = inRealization > 0 && realizationHref ? realizationHref : null;
  if (isBoardEmpty(board)) {
    return (
      <div data-slot="needs-board">
        {filtersActive && clearHref ? (
          <NoResults clearHref={clearHref} title={NEEDS_BOARD_TEXT.noResults} />
        ) : (
          <EmptyState title={NEEDS_BOARD_TEXT.emptyTitle} body={toRealization ? inRealizationText(inRealization) : NEEDS_BOARD_TEXT.emptyBody}>
            {toRealization ? (
              <Button variant="outline" className="min-h-11 sm:min-h-8" render={<HashFocusLink href={toRealization} />} nativeButton={false}>
                {HUB_TEXT.goToOverview}
              </Button>
            ) : null}
          </EmptyState>
        )}
      </div>
    );
  }
  const [summaryFirst, ...summaryRest] = needsSummaryPieces(board.counts);
  const { soon, later, undated } = stepsHorizon(board.steps, today);
  const laterSteps = later.reduce((sum, month) => sum + month.rows.length, 0);
  return (
    <div data-slot="needs-board" className="space-y-8">
      <Block id="cosa-serve-requisiti" title={NEEDS_BOARD_TEXT.requirements} slot="needs-requirements">
        {board.areas.length ? (
          <>
            <p data-slot="needs-summary" className="text-sm text-muted-foreground tabular-nums">
              {/* Il trimestre che si guarda, poi i conteggi: il «·» resta con il pezzo prima, la riga va a capo dopo il «·», mai prima. */}
              {quarter ? `${keepTogether(quarter)}${SCREEN_SEPARATOR}` : null}
              <span className="font-medium text-foreground">{wholePiece(summaryFirst)}</span>
              {summaryRest.length ? `${SCREEN_SEPARATOR}${joinPieces(summaryRest)}` : null}
            </p>
            <div className="space-y-1">
              {board.areas.map((area) => (
                <AreaTable key={area.key} area={area} hrefOf={hrefOf} palette={agents} open={searched} />
              ))}
            </div>
          </>
        ) : (
          // Altri blocchi sì, requisiti no: lo si dice, invece di togliere «Requisiti».
          <p data-slot="needs-none" className="text-sm text-muted-foreground">
            {filtersActive ? NEEDS_BOARD_TEXT.noResults : NEEDS_BOARD_TEXT.nothingToAsk}
          </p>
        )}
      </Block>

      {board.steps.length || board.stepsDone.length ? (
        <Block id="cosa-serve-passi" title={NEEDS_BOARD_TEXT.steps} slot="needs-steps">
          {soon.map((month) => (
            <StepMonth key={month.key} month={month} hrefOf={hrefOf} palette={agents} />
          ))}
          {later.length ? (
            <Disclosure summary={needStepsLaterText(laterSteps)} slot="needs-steps-later">
              <div className="space-y-3">
                {later.map((month) => (
                  <StepMonth key={month.key} month={month} hrefOf={hrefOf} palette={agents} />
                ))}
              </div>
            </Disclosure>
          ) : null}
          {undated ? (
            <Disclosure summary={needStepsUndatedText(undated.rows.length)} slot="needs-steps-undated">
              <StepList rows={undated.rows} hrefOf={hrefOf} palette={agents} />
            </Disclosure>
          ) : null}
          {board.stepsDone.length ? (
            <Disclosure summary={needDoneSummaryText("passo", board.stepsDone.length)} slot="needs-steps-done">
              <StepList rows={board.stepsDone} hrefOf={hrefOf} palette={agents} />
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

      {toRealization ? (
        <p data-slot="needs-in-progress" className="text-sm text-muted-foreground">
          {keepTogether(inRealizationText(inRealization))}{" "}
          <HashFocusLink
            href={toRealization}
            className="rounded-sm font-medium text-primary underline underline-offset-4 outline-none hover:decoration-2 focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            {HUB_TEXT.goToOverview}
          </HashFocusLink>
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

/** I tag degli agenti che una riga serve («LIBRA», «ORSA»), nei colori della pagina: uno per agente. */
function AgentTags({ agents, palette }: { agents: readonly string[]; palette: AgentPalette | null }) {
  return (
    <span data-slot="need-agents" className="flex min-w-0 flex-wrap items-center gap-1">
      {agents.map((agent) => (
        <AgentTag key={agent} label={agent} tone={agentToneOf(palette, agent)} />
      ))}
    </span>
  );
}

/**
 * Gli agenti da mostrare in «Per»: solo se l'esigenza serve più di uno use case. Con uno solo il
 * suo link dice già l'agente («TJ-0002 · LIBRA L1 · Lettura delle fatture estere»): il tag lo
 * ripeterebbe, anche ai lettori di schermo.
 */
function shownAgents(row: NeedRow): string[] {
  return row.useCases.length > 1 ? needAgents(row.useCases) : [];
}

/** La cella «Per» della tabella: con più use case prima i loro agenti, se i titoli li hanno, poi «Per» com'era. */
function NeedForCell({ row, hrefOf, palette }: { row: NeedRow; hrefOf: (id: string) => string; palette: AgentPalette | null }) {
  const agents = shownAgents(row);
  if (!agents.length) return <NeedFor row={row} hrefOf={hrefOf} />;
  return (
    <div className="flex min-w-0 flex-col items-start gap-1">
      <AgentTags agents={agents} palette={palette} />
      <NeedFor row={row} hrefOf={hrefOf} />
    </div>
  );
}

function What({ row }: { row: NeedRow }) {
  return (
    <div className="min-w-0">
      <p className="text-sm font-medium break-words">{keepTogether(row.title)}</p>
      {row.detail ? <p className="line-clamp-2 text-xs text-muted-foreground break-words">{keepTogether(row.detail)}</p> : null}
    </div>
  );
}

function Due({ row }: { row: NeedRow }) {
  return <span className={cn("tabular-nums", row.due ? undefined : "text-muted-foreground")}>{keepTogether(row.due) ?? NEEDS_BOARD_TEXT.none}</span>;
}

/**
 * Un'area di «Requisiti»: una riga chiusa con il nome e i suoi conteggi («Accessi · 12 da chiedere ·
 * 4 in attesa · 3 a posto»), che si apre sulla tabella; `open` (una ricerca) la rende aperta. Il
 * nome dà il titolo alla sezione e alle tabelle.
 */
function AreaTable({ area, hrefOf, palette, open }: { area: NeedAreaTable; hrefOf: (id: string) => string; palette: AgentPalette | null; open: boolean }) {
  const headingId = `cosa-serve-area-${area.key}`;
  // «Entro» solo se una riga dell'area ha una data: una colonna di «—» non dice niente. La stessa
  // scelta per le righe aperte e quelle a posto, così le due tabelle hanno le stesse colonne.
  const withDue = [...area.open, ...area.done].some((row) => row.due);
  const pieces = needAskPieces(area.counts);
  return (
    <section aria-labelledby={headingId} data-need-area={area.key}>
      <Disclosure
        slot="needs-area"
        defaultOpen={open}
        summary={
          <span className="min-w-0">
            <span id={headingId} className="font-medium text-foreground">
              {area.label}
            </span>
            <span className="tabular-nums">{pieces.length ? `${SCREEN_SEPARATOR}${joinPieces(pieces)}` : null}</span>
          </span>
        }
      >
        <div className="space-y-2 pb-3">
          {area.open.length ? <NeedTable rows={area.open} hrefOf={hrefOf} palette={palette} labelledBy={headingId} withDue={withDue} /> : null}
          {area.done.length ? (
            <Disclosure summary={needDoneSummaryText("requisito", area.done.length)} slot="needs-area-done">
              <NeedTable rows={area.done} hrefOf={hrefOf} palette={palette} labelledBy={headingId} withDue={withDue} />
            </Disclosure>
          ) : null}
        </div>
      </Disclosure>
    </section>
  );
}

/**
 * La testa di una riga degli elenchi: il titolo e lo stato. Al telefono (riquadro sotto i 28rem) lo
 * stato va sotto il titolo, che così ha tutta la riga: accanto, «Chiesta, in attesa» lo stringeva
 * in una colonna di 220 px, fino a sei righe.
 */
const ROW_HEAD = "flex flex-col items-start gap-1 @md/hub:flex-row @md/hub:justify-between @md/hub:gap-3";

/**
 * Una tabella quando il riquadro della pagina (`@container/hub` di hub.tsx) è largo almeno 56rem;
 * più stretto un elenco con le stesse cose (mai le due insieme a schermo). Sulla larghezza della
 * finestra (768 px) la tabella aveva circa 460 px accanto alla barra laterale: Stato ed Entro
 * restavano tagliati. «Per» ha un quinto della riga o più: aperto, «Per 6 use case» elenca i
 * codici e i titoli senza tagliarli dopo poche parole. Senza date nell'area, niente «Entro» e
 * le altre colonne si allargano.
 */
function NeedTable({
  rows,
  hrefOf,
  palette,
  labelledBy,
  withDue = true,
}: {
  rows: readonly NeedRow[];
  hrefOf: (id: string) => string;
  palette: AgentPalette | null;
  labelledBy: string;
  withDue?: boolean;
}) {
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
                <td className="px-3 py-2 break-words">{row.owner ? keepTogether(row.owner) : <span className="text-muted-foreground">{NEEDS_BOARD_TEXT.none}</span>}</td>
                <td className="px-3 py-2">
                  <NeedForCell row={row} hrefOf={hrefOf} palette={palette} />
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
            <div className={ROW_HEAD}>
              <What row={row} />
              <StatusDot tone={row.status.tone} label={row.status.label} className="shrink-0" />
            </div>
            <MetaLine row={row} hrefOf={hrefOf} palette={palette} />
          </li>
        ))}
      </ul>
    </>
  );
}

/**
 * «Chi · Entro · Per» sotto il titolo, per gli elenchi. Ogni «·» resta con la parte prima: la riga va
 * a capo dopo il «·», mai prima. Con più di uno use case gli agenti serviti («LIBRA»,
 * «ORSA») su una riga loro, prima degli use case. Il link a un solo use case («TJ-0008 · ATLAS A1 ·
 * …», che dice già l'agente) sta su una riga sua: è lungo, ha già i suoi « · », e in mezzo alla riga
 * grigia non si capirebbe dove inizia. «Per 3 use case» chiude la riga senza «·» e, aperto, va a
 * capo da solo. Un `<div>`, non un `<p>`: un `<details>` non è testo e dentro un `<p>` il parser
 * spezzerebbe il DOM.
 */
function MetaLine({ row, hrefOf, palette }: { row: NeedRow; hrefOf: (id: string) => string; palette: AgentPalette | null }) {
  const agents = shownAgents(row);
  const parts: Array<{ key: string; node: ReactNode }> = [];
  if (row.owner) parts.push({ key: "chi", node: keepTogether(row.owner) });
  if (row.due) parts.push({ key: "entro", node: <span className="tabular-nums">{keepTogether(row.due)}</span> });
  if (!row.useCases.length && row.forLabel) parts.push({ key: "per", node: <NeedFor row={row} hrefOf={hrefOf} /> });
  const one = row.useCases.length === 1;
  const several = row.useCases.length > 1;
  if (!parts.length && !one && !several) return null;
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
      {parts.map((part, index) => (
        <span key={part.key} data-meta={part.key} className="inline-flex min-w-0 items-center gap-x-2">
          <span className="min-w-0">{part.node}</span>
          {index < parts.length - 1 ? <span aria-hidden>·</span> : null}
        </span>
      ))}
      {agents.length ? (
        <span data-meta="agenti" className="flex min-w-0 basis-full">
          <AgentTags agents={agents} palette={palette} />
        </span>
      ) : null}
      {one ? (
        <span data-meta="per" className="flex min-w-0 basis-full">
          <NeedFor row={row} hrefOf={hrefOf} />
        </span>
      ) : null}
      {several ? <NeedFor row={row} hrefOf={hrefOf} /> : null}
    </div>
  );
}

/** Un mese di «Prossimi passi»: il titolo («Novembre 2026», «Senza data») e i suoi passi. */
function StepMonth({ month, hrefOf, palette }: { month: NeedStepMonth; hrefOf: (id: string) => string; palette: AgentPalette | null }) {
  return (
    <section aria-labelledby={`cosa-serve-mese-${month.key}`} className="space-y-2">
      <h3 id={`cosa-serve-mese-${month.key}`} className="text-xs font-medium text-muted-foreground">
        {month.label}
      </h3>
      <StepList rows={month.rows} hrefOf={hrefOf} palette={palette} />
    </section>
  );
}

function StepList({ rows, hrefOf, palette }: { rows: readonly NeedRow[]; hrefOf: (id: string) => string; palette: AgentPalette | null }) {
  return (
    <ul className="divide-y rounded-lg border">
      {rows.map((row) => (
        <li key={row.id} data-need={row.id} className="space-y-1.5 px-3 py-2.5">
          <div className={ROW_HEAD}>
            <What row={row} />
            <StatusDot tone={row.status.tone} label={row.status.label} className="shrink-0" />
          </div>
          <MetaLine row={row} hrefOf={hrefOf} palette={palette} />
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
            <span className="break-words">{keepTogether(row.title)}</span>
            {row.owner || row.due ? (
              <span className="text-xs text-muted-foreground">{keepTogether([row.owner, row.due].filter(Boolean).join(" · "))}</span>
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
              <span className="text-muted-foreground">{SCREEN_SEPARATOR}</span>
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
                <span className="font-medium">{keepTogether(line.label)}</span>
                <span className="text-muted-foreground">{`${SCREEN_SEPARATOR}${line.confidence.toLowerCase()}`}</span>
                <span className="block text-xs text-muted-foreground tabular-nums">{keepTogether(line.text)}</span>
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
