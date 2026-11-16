"use client";

/**
 * «Mappatura board»: la scheda «Classificazione», S2b (docs/mappatura/MAPPATURA-BOARD-PIANO.md §1.4, §4.10, §7.3; P22–P28,
 * P37, P42–P46).
 *
 * Prima del completamento: la testa e il blocco «La classificazione arriva alla fine» (il bottone pieno è quello della
 * testa, «Completa la mappatura»). Dopo: la testa con, per chi rivede e solo se un passo è diverso dalla proposta,
 * «Usa gli stream proposti» → quattro riquadri (i tre stream con passi e ore, l'esposizione media all'AI) → la riga dei
 * passi da classificare (e il bottone della testa dice «Classifica {n} passi») → la legenda e i filtri → la stessa
 * mappa di «Processi di oggi», stesse righe, stesso ordine, ogni passo con il suo stream (badge e bordo), «AI {x}%» e la
 * pillola della decisione → gli use case nati da questa mappatura. Un passo si apre nel drawer che confronta.
 *
 * Legge la board con `useBoard`: ogni modifica (uno stream scelto, un passo aggiunto dall'assistente) cambia riquadri,
 * legenda e mappa insieme. I filtri non si salvano.
 */
import { Fragment, useState, type JSX } from "react";
import { hasHumanDecision, processLetter, stepCode, streamNumbers, type BoardStep, type MappingBoard } from "../../../lib/mappatura/board-model.ts";
import { STREAM_LABEL, formatCount } from "../../../lib/mappatura/text.ts";
import { STREAMS, type Stream } from "../../../lib/mappatura/vocab.ts";
import type { ClassificationViewProps } from "../contracts.ts";
import { CompleteButton } from "../companion/complete-button.tsx";
import { useBoard, useBoardClient } from "../store/use-board.tsx";
import { BoardButton, Dot, ExposureBadge, FilterChip, Legend, LegendItem, StreamBadge } from "../ui/atoms.tsx";
import { BoardTitle, ViewHead } from "../ui/frame.tsx";
import { ProcessMap, ProcessRow, StepArrow, StepCard } from "../ui/map.tsx";
import { EmptyBlock } from "../ui/edit.tsx";
import { ClassificationDrawer } from "./classification-drawer.tsx";
import { CLASSIFICATION_TEXT, exposureTileValue, streamTileLabel, toClassifyLine } from "./text.ts";
import { UseCaseRows } from "./use-case-rows.tsx";

/** Il filtro della mappa: tutti i passi, uno stream, o quelli da classificare. */
export type StreamFilter = "all" | Stream | "none";

/** Un passo resta acceso con questo filtro; gli altri si sfumano al 28 % (P45). */
export function matchesFilter(step: Pick<BoardStep, "stream">, filter: StreamFilter): boolean {
  if (filter === "all") return true;
  return filter === "none" ? step.stream === null : step.stream === filter;
}

/** I quattro riquadri: i tre stream (passi, ore a settimana) e l'esposizione media all'AI. */
export function classificationKpis(board: MappingBoard): Array<{ value: string; label: string; stream?: Stream }> {
  const numbers = streamNumbers(board);
  return [
    ...STREAMS.map((stream) => ({ value: formatCount(numbers.byStream[stream].steps), label: streamTileLabel(stream, numbers.byStream[stream].hoursWeek), stream })),
    { value: exposureTileValue(numbers.avgExposurePct), label: CLASSIFICATION_TEXT.exposureTile },
  ];
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

/** «Usa gli stream proposti»: ogni passo torna alla proposta del classificatore, e il toast lo dice (P46). */
export function resetStreams(client: { dispatch(ops: { t: "streams.reset" }): void; notify(text: string): void }): void {
  client.dispatch({ t: "streams.reset" });
  client.notify(CLASSIFICATION_TEXT.resetDone);
}

const isComplete = (board: Pick<MappingBoard, "unit">) => board.unit.status === "mapped" || board.unit.status === "validated";

/** Un passo sulla mappa classificata: badge dello stream e dell'esposizione, «da classificare», la decisione, il bordo dello stream. */
function ClassifiedStep(p: { step: BoardStep; code: string; dimmed: boolean; onOpen(): void }): JSX.Element {
  const { step } = p;
  const exposure = typeof step.aiExposure === "number" ? Math.round(step.aiExposure * 100) : null;
  const badges =
    step.stream || exposure !== null ? (
      <>
        {step.stream ? <StreamBadge stream={step.stream} small /> : null}
        {exposure !== null ? <ExposureBadge pct={exposure} small /> : null}
      </>
    ) : undefined;
  return (
    <StepCard
      code={p.code}
      title={step.title}
      description={step.description}
      accent={{ kind: "stream", stream: step.stream }}
      badges={badges}
      note={step.stream ? null : CLASSIFICATION_TEXT.card.unclassified}
      gate={hasHumanDecision(step) ? step.decisionLabel : false}
      dimmed={p.dimmed}
      onOpen={p.onOpen}
    />
  );
}

export function ClassificationView(p: ClassificationViewProps): JSX.Element {
  const board = useBoard((state) => state.board);
  const client = useBoardClient();
  const [filter, setFilter] = useState<StreamFilter>("all");
  const [open, setOpen] = useState<string | null>(null);
  const T = CLASSIFICATION_TEXT;
  const complete = isComplete(board);
  const numbers = streamNumbers(board);
  const canReset = complete && board.can.setStream && numbers.differsFromProposal > 0;

  const head = (
    <ViewHead
      eyebrow={T.eyebrow}
      title={<BoardTitle plain={T.title.plain} accent={T.title.accent} />}
      lede={T.lede}
      action={
        <div className="b-cls-actions">
          {canReset ? (
            <BoardButton onClick={() => resetStreams(client)} data-action="reset-streams">
              {T.reset}
            </BoardButton>
          ) : null}
          <CompleteButton workspaceId={p.workspaceId} departmentId={board.unit.id} />
        </div>
      }
    />
  );

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
  return (
    <div className="b-cls" data-b="classification">
      {head}
      <StreamKpis items={classificationKpis(board)} />
      {numbers.unclassified > 0 ? <p className="b-cls-todo">{toClassifyLine(numbers.unclassified)}</p> : null}
      <Legend>
        {STREAMS.map((stream) => (
          <LegendItem key={stream} dot={<Dot tone={stream} />}>
            {STREAM_LABEL[stream]}
          </LegendItem>
        ))}
        <LegendItem dot={<Dot tone="neutral" />}>{T.legend.unclassified}</LegendItem>
        <LegendItem dot={<Dot tone="amber" diamond />}>{T.legend.decides}</LegendItem>
      </Legend>
      <div className="b-cls-filters" role="group" aria-label={T.filters.label}>
        {filters.map((item) => (
          <FilterChip key={item.value} pressed={filter === item.value} onToggle={() => setFilter(item.value)} dot={item.dot}>
            {item.label}
          </FilterChip>
        ))}
      </div>
      <ProcessMap dim={filter !== "all"}>
        {board.processes.map((process, processIndex) => (
          <ProcessRow key={process.id} letter={processLetter(processIndex)} name={process.name} owner={process.owner} steps={process.steps.length}>
            {process.steps.map((step, stepIndex) => (
              <Fragment key={step.id}>
                {stepIndex > 0 ? <StepArrow /> : null}
                <ClassifiedStep step={step} code={stepCode(processIndex, stepIndex)} dimmed={!matchesFilter(step, filter)} onOpen={() => setOpen(step.id)} />
              </Fragment>
            ))}
          </ProcessRow>
        ))}
      </ProcessMap>
      {p.useCaseHub ? (
        <div className="b-block">
          <UseCaseRows cases={board.useCases} areaHref={`/dashboard/${p.workspaceId}/use-cases`} />
        </div>
      ) : null}
      <ClassificationDrawer stepId={open} onClose={() => setOpen(null)} />
    </div>
  );
}
