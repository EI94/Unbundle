import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { StatusDot } from "@/components/uc/ui/status-dot";
import { agentToneOf, type AgentPalette } from "@/lib/use-cases/agents";
import type { NeedGroup, NeedRow, NeedTimelineItem, NeedTimelineSection, NeedsBoard } from "@/lib/use-cases/needs";
import { SCREEN_SEPARATOR, joinPieces, keepTogether, wholePiece } from "@/lib/use-cases/line-breaks";
import {
  NEED_ROWS_SHOWN,
  isBoardEmpty,
  moreStepsText,
  needAgents,
  needDoneSummaryText,
  needForText,
  needGroupLabel,
  needsSummaryPieces,
  splitTimeline,
} from "@/lib/use-cases/needs";
import { AgentTag } from "./agent-tag";
import { moreRowsText } from "./detail/need-draft";
import { Disclosure } from "./disclosure";
import { EmptyState, HUB_TEXT, NoResults, inRealizationText } from "./hub-header";
import { HashFocusLink } from "./list-focus";
import { NeedUseCaseLink, NeedUseCasesDisclosure } from "./need-use-cases";

/** Testi della vista «Cosa serve» (spec di Pierpaolo, 25/10/2026; rilascio 4, una lista sola). */
export const NEEDS_BOARD_TEXT = Object.freeze({
  steps: "Prossimi passi",
  none: "—",
  emptyTitle: "Niente da chiedere per ora",
  emptyBody: "Le esigenze si aggiungono dalla scheda di uno use case, nel capitolo «Cosa serve».",
  noResults: "Niente da chiedere con questi filtri.",
  nothingToAsk: "Niente da chiedere per ora.",
});

export interface NeedsBoardViewProps {
  board: NeedsBoard;
  /** Il titolo del gruppo del cliente (`clientGroupLabel`): il nome del connettore, altrimenti quello del workspace. */
  clientLabel: string;
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
   * Con una ricerca (`?q=`) le parti chiuse della vista sono aperte: si legge subito quello che si
   * cerca. Gli altri filtri, anche il «Trimestre» di «Prossimo passo», le lasciano chiuse.
   */
  searched?: boolean;
  /** Il trimestre del filtro («T4 2026», «Più avanti»): in testa alla riga dei conteggi; null senza. */
  quarter?: string | null;
}

/**
 * La vista «Cosa serve», solo per i revisori e in sola lettura (spec di Pierpaolo, 25/10/2026;
 * rilascio 4, «Referente e Cosa serve»): una lista sola, ogni richiesta una volta, sotto chi deve
 * muoversi, con accanto la linea del tempo dei prossimi passi.
 * - In cima la riga dei conteggi («96 aperti · 66 da chiedere · …»), sempre il primo `<p>` della
 *   vista; con il filtro «Trimestre» comincia dal trimestre («T4 2026 · 67 aperti · …»).
 * - I gruppi, per organizzazione e mai per persona: il cliente (il nome del connettore, «Rondine e
 *   Ferralba», con le cose da fare «Insieme»), «Fornitori», «Lateral Space», «Da assegnare»; solo
 *   quelli con righe, senza numeri nel titolo. In ogni gruppo prima quelli da verificare, poi l'ordine
 *   del team (`needsActionFirst`, come la scheda e il pannello); le prime cinque righe in vista
 *   (`NEED_ROWS_SHOWN`), le altre sotto «Mostra le altre N», chiuse. Una riga: il titolo, lo stato nei
 *   cinque gruppi con il suo dettaglio, poi «Chi», «Entro» e «Per» (uno use case per intero, o «Per
 *   N use case» con prima gli agenti serviti); niente dettaglio, che sta nella scheda. Dopo i gruppi
 *   «Già a posto · N», chiuso.
 * - «Prossimi passi»: dal riquadro di 58rem una colonna di 18rem accanto alla lista, sotto più
 *   stretto. «Prima di oggi» (gli scaduti), un mese per volta da quello di oggi, «Senza data»; i
 *   primi cinque in vista, gli altri sotto «Mostra gli altri N» (la sezione spezzata ripete il suo
 *   titolo), i fatti sotto «Fatti · N», chiusi.
 * Gli use case in realizzazione stanno nella Panoramica: qui solo una riga con il link alla sua
 * sezione «In realizzazione». Nessun titolo visibile: la scheda attiva del selettore nomina la vista.
 * Si conta solo per stato, mai per persona: «Chi» è un testo della riga, mai contato né filtrato. Le
 * esigenze si cambiano nella scheda dello use case. Componente senza stato: si rende sul server.
 */
export function NeedsBoardView({
  board,
  clientLabel,
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
  const withTimeline = board.timeline.sections.length > 0 || board.timeline.done.length > 0;
  return (
    <div data-slot="needs-board" className="space-y-6">
      <p data-slot="needs-summary" className="text-sm text-muted-foreground tabular-nums">
        {/* Il trimestre che si guarda, poi i conteggi: il «·» resta con il pezzo prima, la riga va a capo dopo il «·», mai prima. */}
        {quarter ? `${keepTogether(quarter)}${SCREEN_SEPARATOR}` : null}
        <span className="font-medium text-foreground">{wholePiece(summaryFirst)}</span>
        {summaryRest.length ? `${SCREEN_SEPARATOR}${joinPieces(summaryRest)}` : null}
      </p>
      {/*
        Due colonne sul riquadro della pagina (`@container/hub`), mai sulla finestra: dai 58rem la lista
        e accanto la linea del tempo, 18rem; più stretto la linea del tempo va sotto la lista.
      */}
      <div data-slot="needs-layout" className={withTimeline ? "grid gap-8 @min-[58rem]/hub:grid-cols-[minmax(0,1fr)_18rem] @min-[58rem]/hub:gap-x-8" : undefined}>
        <div data-slot="needs-groups" className="min-w-0 space-y-8">
          {board.groups.length ? (
            board.groups.map((group) => <Group key={group.key} group={group} clientLabel={clientLabel} hrefOf={hrefOf} palette={agents} open={searched} />)
          ) : (
            // Passi sì, requisiti aperti no: lo si dice nella colonna della lista.
            <p data-slot="needs-none" className="text-sm text-muted-foreground">
              {filtersActive ? NEEDS_BOARD_TEXT.noResults : NEEDS_BOARD_TEXT.nothingToAsk}
            </p>
          )}
          {board.done.length ? (
            <Disclosure summary={needDoneSummaryText("requisito", board.done.length)} slot="needs-done" defaultOpen={searched}>
              <RowList rows={board.done} hrefOf={hrefOf} palette={agents} />
            </Disclosure>
          ) : null}
        </div>
        {withTimeline ? (
          <aside data-slot="needs-timeline" className="min-w-0 self-start">
            <Timeline sections={board.timeline.sections} done={board.timeline.done} hrefOf={hrefOf} palette={agents} open={searched} />
          </aside>
        ) : null}
      </div>

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

/**
 * Un gruppo: il titolo (l'organizzazione, senza numeri), le prime cinque righe e le altre sotto
 * «Mostra le altre N», chiuse (aperte con una ricerca).
 */
function Group({ group, clientLabel, hrefOf, palette, open }: { group: NeedGroup; clientLabel: string; hrefOf: (id: string) => string; palette: AgentPalette | null; open: boolean }) {
  const headingId = `cosa-serve-gruppo-${group.key}`;
  const shown = group.open.slice(0, NEED_ROWS_SHOWN);
  const more = group.open.slice(NEED_ROWS_SHOWN);
  return (
    <section aria-labelledby={headingId} data-need-group={group.key} className="space-y-2">
      <h2 id={headingId} className="text-sm font-semibold">
        {needGroupLabel(group.key, clientLabel)}
      </h2>
      <RowList rows={shown} hrefOf={hrefOf} palette={palette} />
      {more.length ? (
        <Disclosure summary={moreRowsText(more.length)} slot="needs-group-more" defaultOpen={open}>
          <RowList rows={more} hrefOf={hrefOf} palette={palette} />
        </Disclosure>
      ) : null}
    </section>
  );
}

/**
 * L'id del titolo di una riga o di un passo (`cosa-serve-titolo-{id}`): «Per N use case» lo legge come
 * descrizione, invece di ripetere il titolo per i lettori di schermo in ogni riga. Ogni esigenza è una
 * volta sola nella vista, quindi l'id è unico.
 */
const titleIdOf = (id: string) => `cosa-serve-titolo-${id}`;

/**
 * «Per» di una riga: senza use case collegati il testo libero (o «—»); con uno solo il suo link,
 * «RD-0012 · Smistamento»; con più di uno «Per N use case», chiuso, che si apre sui link. Ogni link
 * apre il pannello.
 */
function NeedFor({ row, hrefOf }: { row: NeedRow; hrefOf: (id: string) => string }) {
  if (!row.useCases.length) return <span className={row.forLabel ? undefined : "text-muted-foreground"}>{row.forLabel ?? NEEDS_BOARD_TEXT.none}</span>;
  if (row.useCases.length === 1) return <NeedUseCaseLink useCase={row.useCases[0]} href={hrefOf(row.useCases[0].id)} scroll={false} />;
  return <NeedUseCasesDisclosure summary={needForText(row.useCases.length)} contextId={titleIdOf(row.id)} useCases={row.useCases} hrefOf={hrefOf} scroll={false} />;
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
 * suo link dice già l'agente («RD-0002 · LIBRA L1 · Lettura dei documenti esteri»): il tag lo
 * ripeterebbe, anche ai lettori di schermo.
 */
function shownAgents(row: NeedRow): string[] {
  return row.useCases.length > 1 ? needAgents(row.useCases) : [];
}

/**
 * Le righe dei requisiti, la stessa forma a ogni larghezza e quella delle righe della scheda (la
 * tabella del rilascio 3 non c'è più): il titolo, poi lo stato nei cinque gruppi con «Chi · Entro ·
 * il dettaglio dello stato», poi «Per». Nessun dettaglio dell'esigenza: si legge nella scheda.
 */
function RowList({ rows, hrefOf, palette }: { rows: readonly NeedRow[]; hrefOf: (id: string) => string; palette: AgentPalette | null }) {
  return (
    <ul data-slot="needs-list" className="divide-y rounded-lg border">
      {rows.map((row) => (
        <li key={row.id} data-need={row.id} className="space-y-1 px-3 py-2.5">
          <p id={titleIdOf(row.id)} className="text-sm font-medium break-words">
            {keepTogether(row.title)}
          </p>
          <MetaLine row={row} hrefOf={hrefOf} palette={palette} status />
        </li>
      ))}
    </ul>
  );
}

/**
 * Sotto il titolo, come nella scheda: lo stato (il gruppo dei cinque, «Da chiedere», «In attesa», «Da
 * verificare», «Ferma», «A posto», o lo stato di un passo) e «Chi · Entro · il dettaglio dello
 * stato» («manca il dato», «risposta parziale», «non si applica»). Ogni «·» resta con la parte prima:
 * la riga va a capo dopo il «·», mai prima. Poi «Per»: con più di uno use case gli agenti serviti
 * («LIBRA», «ORSA») e «Per N use case» su una riga loro, chiuso, che aperto va a capo da solo; il link
 * a un solo use case («RD-0008 · ATLAS A1 · …», che dice già l'agente) su una riga sua: è lungo, ha
 * già i suoi « · », e in mezzo alla riga grigia non si capirebbe dove inizia. Un `<div>`, non un
 * `<p>`: un `<details>` non è testo e dentro un `<p>` il parser spezzerebbe il DOM.
 */
function MetaLine({ row, hrefOf, palette, status = false }: { row: NeedRow; hrefOf: (id: string) => string; palette: AgentPalette | null; status?: boolean }) {
  const agents = shownAgents(row);
  const parts: Array<{ key: string; node: ReactNode }> = [];
  if (row.owner) parts.push({ key: "chi", node: keepTogether(row.owner) });
  if (row.due) parts.push({ key: "entro", node: <span className="tabular-nums">{keepTogether(row.due)}</span> });
  if (status && row.statusNote) parts.push({ key: "nota", node: keepTogether(row.statusNote) });
  if (!row.useCases.length && row.forLabel) parts.push({ key: "per", node: <NeedFor row={row} hrefOf={hrefOf} /> });
  const one = row.useCases.length === 1;
  const several = row.useCases.length > 1;
  if (!status && !parts.length && !one && !several) return null;
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
      {status ? <StatusDot tone={row.status.tone} label={row.status.label} /> : null}
      {parts.map((part, index) => (
        <span key={part.key} data-meta={part.key} className="inline-flex min-w-0 items-center gap-x-2">
          <span className="min-w-0">{part.node}</span>
          {index < parts.length - 1 ? <span aria-hidden>·</span> : null}
        </span>
      ))}
      {several ? (
        <span data-meta="per" className="flex min-w-0 basis-full flex-wrap items-center gap-x-2 gap-y-1">
          {agents.length ? (
            <span data-meta="agenti" className="flex min-w-0">
              <AgentTags agents={agents} palette={palette} />
            </span>
          ) : null}
          <NeedFor row={row} hrefOf={hrefOf} />
        </span>
      ) : null}
      {one ? (
        <span data-meta="per" className="flex min-w-0 basis-full">
          <NeedFor row={row} hrefOf={hrefOf} />
        </span>
      ) : null}
    </div>
  );
}

/**
 * «Prossimi passi»: la linea del tempo. «Prima di oggi», un mese per volta, «Senza data»; i primi
 * cinque in vista, gli altri sotto «Mostra gli altri N» (`splitTimeline`: la sezione spezzata ripete
 * il suo titolo dentro), i fatti sotto «Fatti · N». Chiusi, aperti con una ricerca.
 */
function Timeline({
  sections,
  done,
  hrefOf,
  palette,
  open,
}: {
  sections: readonly NeedTimelineSection[];
  done: readonly NeedTimelineItem[];
  hrefOf: (id: string) => string;
  palette: AgentPalette | null;
  open: boolean;
}) {
  const { visible, hidden, hiddenCount } = splitTimeline(sections);
  return (
    <section aria-labelledby="cosa-serve-passi" data-slot="needs-steps" className="space-y-3">
      <h2 id="cosa-serve-passi" className="text-sm font-semibold">
        {NEEDS_BOARD_TEXT.steps}
      </h2>
      {visible.map((section) => (
        <TimelineSection key={section.key} section={section} idOf={`cosa-serve-passi-${section.key}`} hrefOf={hrefOf} palette={palette} />
      ))}
      {hiddenCount ? (
        <Disclosure summary={moreStepsText(hiddenCount)} slot="needs-steps-more" defaultOpen={open}>
          <div className="space-y-3">
            {hidden.map((section) => (
              <TimelineSection key={section.key} section={section} idOf={`cosa-serve-passi-${section.key}-altri`} hrefOf={hrefOf} palette={palette} />
            ))}
          </div>
        </Disclosure>
      ) : null}
      {done.length ? (
        <Disclosure summary={needDoneSummaryText("passo", done.length)} slot="needs-steps-done" defaultOpen={open}>
          <ol className="space-y-3 border-l border-border pl-3">
            {done.map((row) => (
              <TimelineItem key={row.id} item={row} hrefOf={hrefOf} palette={palette} />
            ))}
          </ol>
        </Disclosure>
      ) : null}
    </section>
  );
}

/** Una sezione della linea del tempo: il titolo («Prima di oggi», «Novembre 2026», «Senza data») e i suoi passi. */
function TimelineSection({ section, idOf, hrefOf, palette }: { section: NeedTimelineSection; idOf: string; hrefOf: (id: string) => string; palette: AgentPalette | null }) {
  return (
    <section aria-labelledby={idOf} className="space-y-2">
      <h3 id={idOf} className="text-xs font-medium text-muted-foreground">
        {section.label}
      </h3>
      <ol className="space-y-3 border-l border-border pl-3">
        {section.items.map((item) => (
          <TimelineItem key={item.id} item={item} hrefOf={hrefOf} palette={palette} />
        ))}
      </ol>
    </section>
  );
}

/**
 * Un passo: la data su una riga sua («28 ott», `<time dateTime>`), il titolo, lo stato («Proposto»,
 * «Confermato») con «Chi», poi «Per» come nelle righe.
 */
function TimelineItem({ item, hrefOf, palette }: { item: NeedTimelineItem; hrefOf: (id: string) => string; palette: AgentPalette | null }) {
  return (
    <li data-need={item.id} className="space-y-1">
      {item.dueOn && item.due ? (
        <time dateTime={item.dueOn} className="block text-xs font-medium tabular-nums">
          {keepTogether(item.due)}
        </time>
      ) : item.due ? (
        <span className="block text-xs font-medium">{keepTogether(item.due)}</span>
      ) : null}
      <p id={titleIdOf(item.id)} className="text-sm break-words">
        {keepTogether(item.title)}
      </p>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
        <StatusDot tone={item.status.tone} label={item.status.label} />
        {item.owner ? (
          <span data-meta="chi" className="min-w-0">
            {keepTogether(item.owner)}
          </span>
        ) : null}
      </div>
      <MetaLine row={{ ...item, owner: null, due: null }} hrefOf={hrefOf} palette={palette} />
    </li>
  );
}
