"use client";

/**
 * «Mappatura board»: la scheda «Con l'AI» (prima «Classificazione»), S2b (docs/mappatura/MAPPATURA-BOARD-PIANO.md §1.4,
 * §4.10, §7.3; P22–P28, P37, P42–P46; rilascio 10, docs/ui-10/PROPOSTA-10.md §3.7: niente doppioni).
 *
 * Prima del completamento: la testa e il blocco «La classificazione arriva alla fine» (il bottone pieno è quello della
 * testa, «Completa la mappatura»). Dopo: la testa (il titolo e il bottone, che dice «Classifica {n} passi» quando ne
 * restano) → tre riquadri, uno per categoria, con passi e ore → i chip che filtrano e fanno anche da legenda (le tre
 * categorie e «Da classificare», con il loro colore), il «?» per «decide una persona» → la stessa mappa di «Oggi»,
 * stesse righe, stesso ordine, ogni passo con la sua categoria (badge e bordo) e la pillola della decisione → gli use
 * case nati da questa mappatura, solo se ce ne sono. Un passo si apre nel drawer che confronta, con il suo indirizzo
 * (`?apri=<passo>`). «Usa le categorie proposte» sta nel «⋯» della testata della board.
 *
 * Legge la board con `useBoard`: ogni modifica (una categoria scelta, un passo aggiunto dall'assistente) cambia
 * riquadri, chip e mappa insieme. I filtri non si salvano.
 */
import { Fragment, useState, type JSX } from "react";
import { useSheetParam } from "../../ui-10/side-sheet.tsx";
import { sheetIdParam } from "../../context/view-model.ts";
import { useArrivalStep } from "../board/arrival.tsx";
import { hasHumanDecision, processLetter, stepCode, streamNumbers, type BoardStep, type MappingBoard } from "../../../lib/mappatura/board-model.ts";
import { STREAM_LABEL, formatCount } from "../../../lib/mappatura/text.ts";
import { STREAMS, type Stream } from "../../../lib/mappatura/vocab.ts";
import type { ClassificationViewProps } from "../contracts.ts";
import { CompleteButton } from "../companion/complete-button.tsx";
import { useBoard } from "../store/use-board.tsx";
import { Dot, FilterChip, Legend, LegendItem, StreamBadge } from "../ui/atoms.tsx";
import { BoardTitle, ViewHead } from "../ui/frame.tsx";
import { ProcessMap, ProcessRow, StepArrow, StepCard, widestRow } from "../ui/map.tsx";
import { EmptyBlock, fieldHolder } from "../ui/edit.tsx";
import { ClassificationDrawer } from "./classification-drawer.tsx";
import { CLASSIFICATION_TEXT, streamTileLabel } from "./text.ts";
import { UseCaseRows } from "./use-case-rows.tsx";

/** Il filtro della mappa: tutti i passi, uno stream, o quelli da classificare. */
export type StreamFilter = "all" | Stream | "none";

/** Un passo resta acceso con questo filtro; gli altri si sfumano al 28 % (P45). */
export function matchesFilter(step: Pick<BoardStep, "stream">, filter: StreamFilter): boolean {
  if (filter === "all") return true;
  return filter === "none" ? step.stream === null : step.stream === filter;
}

/**
 * I tre riquadri: una categoria l'uno, con i suoi passi e le ore a settimana. (Rilascio 10, §3.7) L'esposizione media
 * all'AI esce dai riquadri: sta nei «Dettagli tecnici» del drawer di ogni passo.
 */
export function classificationKpis(board: MappingBoard): Array<{ value: string; label: string; stream?: Stream }> {
  const numbers = streamNumbers(board);
  return STREAMS.map((stream) => ({ value: formatCount(numbers.byStream[stream].steps), label: streamTileLabel(stream, numbers.byStream[stream].hoursWeek), stream }));
}

/**
 * I riquadri della classificazione: le classi di `Kpis`, con il punto dello stream davanti alla riga di ognuno dei tre
 * (P28: un colore per stream anche nei riquadri). `Kpis` prende solo testi.
 */
function StreamKpis(p: { items: ReadonlyArray<{ value: string; label: string; stream?: Stream }> }): JSX.Element {
  return (
    <div className="b-kpis" data-b="kpis">
      {p.items.map((item) => (
        <div className="b-kpi" key={item.label} data-stream={item.stream}>
          <div className="b-kv">{item.value}</div>
          <div className="b-kl">
            {item.stream ? <Dot tone={item.stream} /> : null}
            {item.label}
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * «Usa le categorie proposte» (nel «⋯» della testata della board, rilascio 10): ogni passo torna alla proposta del
 * classificatore, e il toast lo dice (P46). Con il bottone che l'ha chiesto, il fuoco resta nella vista (F1).
 */
export function resetStreams(client: { dispatch(ops: { t: "streams.reset" }): void; notify(text: string): void }, button?: Pick<Element, "closest">): void {
  if (button) fieldHolder(button)?.focus({ preventScroll: true });
  client.dispatch({ t: "streams.reset" });
  client.notify(CLASSIFICATION_TEXT.resetDone);
}

const isComplete = (board: Pick<MappingBoard, "unit">) => board.unit.status === "mapped" || board.unit.status === "validated";

/**
 * Un passo sulla mappa classificata: il badge della categoria, «da classificare», la decisione, il bordo della
 * categoria. (Rilascio 10, §3.7) Come su «Oggi», la descrizione sta nel drawer; l'esposizione all'AI non sta sulla card:
 * è un dettaglio tecnico, nel drawer.
 */
function ClassifiedStep(p: { step: BoardStep; code: string; dimmed: boolean; onOpen(): void }): JSX.Element {
  const { step } = p;
  const badges = step.stream ? <StreamBadge stream={step.stream} small /> : undefined;
  return (
    <StepCard
      code={p.code}
      title={step.title}
      accent={{ kind: "stream", stream: step.stream }}
      badges={badges}
      note={step.stream ? null : CLASSIFICATION_TEXT.card.unclassified}
      gate={hasHumanDecision(step) ? step.decisionLabel : false}
      dimmed={p.dimmed}
      onOpen={p.onOpen}
    />
  );
}

/** Il passo aperto (`?apri=<passo>`): un id che sembra un uuid. Una funzione del modulo. */
const acceptStep = (raw: string | null) => sheetIdParam(raw);

export function ClassificationView(p: ClassificationViewProps): JSX.Element {
  const board = useBoard((state) => state.board);
  const [filter, setFilter] = useState<StreamFilter>("all");
  const [legend, setLegend] = useState(false);
  const [open, show] = useSheetParam({ initial: useArrivalStep(), accept: acceptStep });
  const T = CLASSIFICATION_TEXT;
  const complete = isComplete(board);

  const head = <ViewHead title={<BoardTitle plain={T.title.plain} accent={T.title.accent} />} action={<CompleteButton workspaceId={p.workspaceId} departmentId={board.unit.id} />} />;

  if (!complete) {
    return (
      <div className="b-cls" data-b="classification">
        {head}
        <EmptyBlock title={T.before.title} text={T.before.text} />
      </div>
    );
  }

  const filters: Array<{ value: StreamFilter; label: string; dot?: JSX.Element }> = [
    { value: "all", label: T.filters.all },
    ...STREAMS.map((stream) => ({ value: stream, label: STREAM_LABEL[stream], dot: <Dot tone={stream} /> })),
    { value: "none", label: T.filters.unclassified, dot: <Dot tone="neutral" /> },
  ];
  const legendId = "b-legenda-con-ai";
  return (
    <div className="b-cls" data-b="classification">
      {head}
      <StreamKpis items={classificationKpis(board)} />
      {/* I chip filtrano e fanno da legenda: le tre categorie e «Da classificare», con il loro colore. */}
      <div className="b-cls-filters" role="group" aria-label={T.filters.label}>
        {filters.map((item) => (
          <FilterChip key={item.value} pressed={filter === item.value} onToggle={() => setFilter(item.value)} dot={item.dot}>
            {item.label}
          </FilterChip>
        ))}
        <button type="button" className="b-iconbtn b-legend-btn" aria-label={T.legend.button} title={T.legend.button} aria-expanded={legend} aria-controls={legendId} onClick={() => setLegend(!legend)} data-b="legend-toggle">
          ?
        </button>
      </div>
      <div id={legendId} hidden={!legend}>
        <Legend>
          <LegendItem dot={<Dot tone="amber" diamond />}>{T.legend.decides}</LegendItem>
        </Legend>
      </div>
      <ProcessMap dim={filter !== "all"} steps={widestRow(board.processes)}>
        {board.processes.map((process, processIndex) => (
          <ProcessRow key={process.id} letter={processLetter(processIndex)} name={process.name} owner={process.owner}>
            {process.steps.map((step, stepIndex) => (
              <Fragment key={step.id}>
                {stepIndex > 0 ? <StepArrow /> : null}
                <ClassifiedStep step={step} code={stepCode(processIndex, stepIndex)} dimmed={!matchesFilter(step, filter)} onOpen={() => show(step.id)} />
              </Fragment>
            ))}
          </ProcessRow>
        ))}
      </ProcessMap>
      {p.useCaseHub && board.useCases.length > 0 ? (
        <div className="b-block">
          <UseCaseRows cases={board.useCases} areaHref={`/dashboard/${p.workspaceId}/use-cases`} />
        </div>
      ) : null}
      <ClassificationDrawer stepId={open} technical={p.lateralSpace === true} onClose={() => show(null)} />
    </div>
  );
}
