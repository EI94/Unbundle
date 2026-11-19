import type { ReactNode } from "react";
import Link from "next/link";
import { Check, MessageCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SegmentedNav } from "@/components/dashboard/segmented-nav";
import { NextStep, type NextStepItem } from "@/components/ui-10/next-step";
import { SEMAFORO_TONE } from "@/components/uc/common/semaforo-tone";
import { StatusDot } from "@/components/uc/ui/status-dot";
import { HOME_TEXT } from "@/lib/home/text";
import { agentToneOf, type AgentPalette } from "@/lib/use-cases/agents";
import { formatInteger } from "@/lib/use-cases/format";
import { keepTogether } from "@/lib/use-cases/line-breaks";
import type { NeedGroup, NeedRow, NeedTimelineItem, NeedTimelineSection, NeedsBoard } from "@/lib/use-cases/needs";
import {
  BOARD_ROWS_SHOWN,
  boardForState,
  firstUseCaseFor,
  isBoardEmpty,
  moreStepsText,
  needAgents,
  needDoneSummaryText,
  needForText,
  needGroupLabel,
  needStateCounts,
  splitTimeline,
} from "@/lib/use-cases/needs";
import type { NeedStateParam } from "@/lib/use-cases/views";
import { cn } from "@/lib/utils";
import { AgentTag } from "./agent-tag";
import { Disclosure } from "./disclosure";
import { EmptyState, HUB_TEXT, NoResults, inRealizationText } from "./hub-header";
import { HashFocusLink } from "./list-focus";
import { NeedUseCaseLink, NeedUseCasesDisclosure } from "./need-use-cases";
import { hubHref, withoutTransient, type HubQuery } from "./use-case-row";

/**
 * Testi della vista «Cosa serve» (spec di Pierpaolo, 25/10/2026; rilascio 4, una lista sola). (Rilascio 10, §4) Il
 * calendario si chiama «Scadenze»; ciò che serve, «informazioni». (Rilascio 10, §3.4) Tre conteggi che filtrano,
 * «Elenco | Calendario», il prossimo passo della vista.
 */
export const NEEDS_BOARD_TEXT = Object.freeze({
  steps: "Scadenze",
  none: "—",
  emptyTitle: "Niente da chiedere per ora",
  emptyBody: "Le informazioni si aggiungono dalla scheda di uno use case, nel capitolo «Cosa serve».",
  noResults: "Niente da chiedere con questi filtri.",
  nothingToAsk: "Niente da chiedere per ora.",
  /** (Rilascio 10, §3.4) I tre conteggi che filtrano, per i lettori di schermo. */
  countsLabel: "Informazioni per stato",
  /** (Rilascio 10, §3.4) L'interruttore tra l'elenco delle informazioni e le «Scadenze». */
  modeLabel: "Elenco o calendario",
  list: "Elenco",
  calendar: "Calendario",
  /** (Rilascio 10, §3.4) Con uno stato del foglio «Filtri» che nessuna informazione ha. */
  noneInState: "Nessuna informazione in questo stato.",
  /** (Rilascio 10, §3.4) Il pulsante pieno quando non ci sono risposte da verificare. */
  ask: "Chiedi le informazioni",
  askWhy: "Apre il primo use case con informazioni da chiedere.",
  /** (Rilascio 10, §5.4) Le righe di un gruppo oltre le prime tre. */
  seeAll: (count: number) => `Vedi tutte (${formatInteger(count)})`,
});

export interface NeedsBoardViewProps {
  board: NeedsBoard;
  /** Il titolo del gruppo del cliente (`clientGroupLabel`): il nome del connettore, altrimenti quello del workspace. */
  clientLabel: string;
  /** I colori degli agenti del workspace (`workspaceAgentPalette`): gli stessi delle corsie. */
  agents?: AgentPalette | null;
  /** id dello use case → il pannello laterale (`?apri=`). */
  hrefOf: (id: string) => string;
  /** (Rilascio 10) La pagina e i suoi parametri: i conteggi che filtrano e «Elenco | Calendario» sono indirizzi. */
  basePath?: string;
  query?: HubQuery;
  /** (Rilascio 10, §3.4) Le informazioni di uno stato (`?stato=`): i conteggi e il foglio «Filtri»; null tutte. */
  state?: NeedStateParam | null;
  /** (Rilascio 10, §3.4) «Calendario» (`?calendario=1`): le «Scadenze» al posto dell'elenco. */
  calendar?: boolean;
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
}

/**
 * Il prossimo passo della vista (rilascio 10, §3.4), il solo pulsante pieno: «Verifica N risposte» se ce ne sono,
 * altrimenti «Chiedi le informazioni»; apre il pannello del primo use case che ne ha (`firstUseCaseFor`). Una risposta
 * da verificare senza use case collegato porta alle righe «Da verificare». null: niente da fare per chi guarda.
 */
export function needsBoardStep(board: NeedsBoard, hrefOf: (id: string) => string, verifyHref: string | null): NextStepItem | null {
  const verify = board.counts.toVerify;
  if (verify > 0) {
    const target = firstUseCaseFor(board, "toVerify");
    const href = target ? hrefOf(target.id) : verifyHref;
    if (href) return { label: HOME_TEXT.steps.verificare.cta(verify), icon: Check, why: HOME_TEXT.steps.verificare.why(verify), mine: true, link: <Link href={href} scroll={false} /> };
  }
  const ask = firstUseCaseFor(board, "toAsk");
  if (ask) return { label: NEEDS_BOARD_TEXT.ask, icon: MessageCircle, why: NEEDS_BOARD_TEXT.askWhy, mine: true, link: <Link href={hrefOf(ask.id)} scroll={false} /> };
  return null;
}

/**
 * La vista «Cosa serve», solo per i revisori e in sola lettura (spec di Pierpaolo, 25/10/2026; rilascio 4, «Referente
 * e Cosa serve»; rilascio 10, §3.4): ogni richiesta una volta, sotto chi deve muoversi.
 * - In cima il prossimo passo (`needsBoardStep`), poi i tre conteggi che filtrano, «Da chiedere 12 · In attesa 7 · Da
 *   verificare 2» (senza gli zeri; uno scelto si toglie con un altro tocco), e l'interruttore «Elenco | Calendario».
 *   «Ferme», «A posto» e «Aperte» stanno nel foglio «Filtri» (`stato=`).
 * - «Elenco»: i gruppi per organizzazione e mai per persona (il cliente con le cose da fare «Insieme», «Fornitori»,
 *   «Lateral Space», «Da assegnare»), solo quelli con righe, senza numeri nel titolo. In ogni gruppo prima quelli da
 *   verificare, poi l'ordine del team (`needsActionFirst`); le prime tre righe in vista (`BOARD_ROWS_SHOWN`), le altre
 *   sotto «Vedi tutte (N)», chiuse. Una riga: il titolo, lo stato (puntino e parola, con il dettaglio), «Chi · entro»,
 *   poi «Per»: lo use case con il tag dell'agente, o «Per N use case» chiuso. Dopo i gruppi «Già a posto · N», chiuso.
 * - «Calendario»: le «Scadenze» (prima «Prossimi passi»): «Prima di oggi» (le scadute), un mese per volta da quello di
 *   oggi, «Senza data»; le prime cinque in vista, le altre sotto «Mostra le altre N», le fatte sotto «Fatte · N».
 * Gli use case in realizzazione stanno nella Panoramica: qui solo una riga con il link alla sua sezione. Si conta solo
 * per stato, mai per persona: «Chi» è un testo della riga, mai contato né filtrato. Le informazioni si cambiano nella
 * scheda dello use case. Componente senza stato: si rende sul server.
 */
export function NeedsBoardView({
  board,
  clientLabel,
  agents = null,
  hrefOf,
  basePath = "",
  query = {},
  state = null,
  calendar = false,
  inRealization = 0,
  realizationHref = null,
  filtersActive = false,
  clearHref,
  searched = false,
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
  const base = withoutTransient(query);
  const hrefWith = (change: Partial<Record<"stato" | "calendario", string | null>>) => hubHref(basePath, base, change);
  const stepCount = board.timeline.sections.reduce((sum, section) => sum + section.items.length, 0);
  const hasSteps = stepCount > 0 || board.timeline.done.length > 0;
  const showCalendar = calendar && hasSteps;
  const shown = boardForState(board, state);
  const step = needsBoardStep(board, hrefOf, hrefWith({ stato: "da-verificare", calendario: null }));
  const counts = needStateCounts(board.counts);
  return (
    <div data-slot="needs-board" data-mode={showCalendar ? "calendario" : "elenco"} className="space-y-6">
      {step ? <NextStep id="cosa-serve-passo" step={step} /> : null}
      {counts.length || hasSteps ? (
        <div data-slot="needs-controls" className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          {counts.length ? (
            <ul data-slot="needs-counts" aria-label={NEEDS_BOARD_TEXT.countsLabel} className="flex min-w-0 flex-wrap items-center gap-1">
              {counts.map((count) => {
                const active = state === count.state && !showCalendar;
                return (
                  <li key={count.state}>
                    <Link
                      href={hrefWith({ stato: active ? null : count.state, calendario: null })}
                      scroll={false}
                      aria-current={active ? "true" : undefined}
                      data-state={count.state}
                      className={cn(
                        "inline-flex min-h-11 items-center gap-1.5 rounded-full px-3 text-sm outline-none transition-colors hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 sm:min-h-8",
                        active ? "bg-muted font-medium text-foreground ring-1 ring-border" : "text-muted-foreground",
                      )}
                    >
                      <span aria-hidden className={cn("size-1.5 shrink-0 rounded-full", SEMAFORO_TONE[count.tone].fill)} />
                      <span>{count.label}</span>{" "}
                      <span className="font-medium text-foreground tabular-nums">{formatInteger(count.count)}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          ) : (
            <span aria-hidden />
          )}
          {hasSteps ? (
            <SegmentedNav
              size="sm"
              ariaLabel={NEEDS_BOARD_TEXT.modeLabel}
              active={showCalendar ? "calendario" : "elenco"}
              items={[
                { key: "elenco", label: NEEDS_BOARD_TEXT.list, href: hrefWith({ calendario: null }) },
                { key: "calendario", label: NEEDS_BOARD_TEXT.calendar, count: stepCount, href: hrefWith({ calendario: "1" }) },
              ]}
            />
          ) : null}
        </div>
      ) : null}

      {showCalendar ? (
        <Timeline sections={board.timeline.sections} done={board.timeline.done} hrefOf={hrefOf} palette={agents} open={searched} />
      ) : (
        <div data-slot="needs-groups" className="min-w-0 space-y-8">
          {shown.groups.length ? (
            shown.groups.map((group) => <Group key={group.key} group={group} clientLabel={clientLabel} hrefOf={hrefOf} palette={agents} open={searched} />)
          ) : state ? (
            <NoResults clearHref={hrefWith({ stato: null })} title={NEEDS_BOARD_TEXT.noneInState} />
          ) : (
            // Passi sì, informazioni aperte no: lo si dice nella colonna della lista.
            <p data-slot="needs-none" className="text-sm text-muted-foreground">
              {filtersActive ? NEEDS_BOARD_TEXT.noResults : NEEDS_BOARD_TEXT.nothingToAsk}
            </p>
          )}
          {shown.done.length ? (
            <Disclosure summary={needDoneSummaryText("requisito", shown.done.length)} slot="needs-done" defaultOpen={searched}>
              <RowList rows={shown.done} hrefOf={hrefOf} palette={agents} />
            </Disclosure>
          ) : null}
        </div>
      )}

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
 * Un gruppo: il titolo (l'organizzazione, senza numeri), le prime tre righe e le altre sotto «Vedi tutte (N)», chiuse
 * (aperte con una ricerca).
 */
function Group({ group, clientLabel, hrefOf, palette, open }: { group: NeedGroup; clientLabel: string; hrefOf: (id: string) => string; palette: AgentPalette | null; open: boolean }) {
  const headingId = `cosa-serve-gruppo-${group.key}`;
  const shown = group.open.slice(0, BOARD_ROWS_SHOWN);
  const more = group.open.slice(BOARD_ROWS_SHOWN);
  return (
    <section aria-labelledby={headingId} data-need-group={group.key} className="space-y-2">
      <h2 id={headingId} className="text-sm font-semibold">
        {needGroupLabel(group.key, clientLabel)}
      </h2>
      <RowList rows={shown} hrefOf={hrefOf} palette={palette} />
      {more.length ? (
        <Disclosure summary={NEEDS_BOARD_TEXT.seeAll(group.open.length)} slot="needs-group-more" defaultOpen={open}>
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
 * «Per» di una riga: senza use case collegati il testo libero (o «—»); con uno solo il suo link, con il tag
 * dell'agente al posto del prefisso (rilascio 10, §3.4), altrimenti «RD-0012 · Smistamento»; con più di uno «Per N use
 * case», chiuso, che si apre sui link. Ogni link apre il pannello.
 */
function NeedFor({ row, hrefOf, palette }: { row: NeedRow; hrefOf: (id: string) => string; palette: AgentPalette | null }) {
  if (!row.useCases.length) return <span className={row.forLabel ? undefined : "text-muted-foreground"}>{row.forLabel ?? NEEDS_BOARD_TEXT.none}</span>;
  if (row.useCases.length === 1) return <NeedUseCaseLink useCase={row.useCases[0]} href={hrefOf(row.useCases[0].id)} scroll={false} agentTag palette={palette} />;
  return <NeedUseCasesDisclosure summary={needForText(row.useCases.length)} contextId={titleIdOf(row.id)} useCases={row.useCases} hrefOf={hrefOf} scroll={false} agentTag palette={palette} />;
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
 * suo link ha già il tag: lo ripeterebbe, anche ai lettori di schermo.
 */
function shownAgents(row: NeedRow): string[] {
  return row.useCases.length > 1 ? needAgents(row.useCases) : [];
}

/**
 * Le righe delle informazioni, la stessa forma a ogni larghezza e quella delle righe della scheda: il titolo, poi lo
 * stato con «Chi · entro», poi «Per». Nessun dettaglio dell'informazione: si legge nella scheda.
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
 * Sotto il titolo, come nella scheda: lo stato (il gruppo dei cinque, «Da chiedere», «In attesa», «Da verificare»,
 * «Ferma», «A posto», con il suo dettaglio in grigio: «manca il dato», «risposta parziale», «non si applica»; o lo
 * stato di un passo) e «Chi · entro». Ogni «·» resta con la parte prima: la riga va a capo dopo il «·», mai prima. Poi
 * «Per»: con più di uno use case gli agenti serviti («LIBRA», «ORSA») e «Per N use case» su una riga loro, chiuso, che
 * aperto va a capo da solo; il link a un solo use case su una riga sua. Un `<div>`, non un `<p>`: un `<details>` non è
 * testo e dentro un `<p>` il parser spezzerebbe il DOM.
 */
function MetaLine({ row, hrefOf, palette, status = false }: { row: NeedRow; hrefOf: (id: string) => string; palette: AgentPalette | null; status?: boolean }) {
  const agents = shownAgents(row);
  const parts: Array<{ key: string; node: ReactNode }> = [];
  if (row.owner) parts.push({ key: "chi", node: keepTogether(row.owner) });
  if (row.due) parts.push({ key: "entro", node: <span className="tabular-nums">{keepTogether(row.due)}</span> });
  if (!row.useCases.length && row.forLabel) parts.push({ key: "per", node: <NeedFor row={row} hrefOf={hrefOf} palette={palette} /> });
  const one = row.useCases.length === 1;
  const several = row.useCases.length > 1;
  if (!status && !parts.length && !one && !several) return null;
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
      {status ? <StatusDot tone={row.status.tone} label={row.status.label} sublabel={row.statusNote ?? undefined} /> : null}
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
          <NeedFor row={row} hrefOf={hrefOf} palette={palette} />
        </span>
      ) : null}
      {one ? (
        <span data-meta="per" className="flex min-w-0 basis-full">
          <NeedFor row={row} hrefOf={hrefOf} palette={palette} />
        </span>
      ) : null}
    </div>
  );
}

/**
 * «Scadenze»: la linea del tempo, nel «Calendario». «Prima di oggi», un mese per volta, «Senza data»; le prime cinque
 * in vista, le altre sotto «Mostra le altre N» (`splitTimeline`: la sezione spezzata ripete il suo titolo dentro), le
 * fatte sotto «Fatte · N». Chiuse, aperte con una ricerca.
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
 * Un passo: la data su una riga sua («28 ott», `<time dateTime>`), il titolo, lo stato («Proposta»,
 * «Confermata», come «scadenza») con «Chi», poi «Per» come nelle righe.
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
