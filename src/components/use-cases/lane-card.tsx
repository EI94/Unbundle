import type { ReactNode } from "react";
import Link from "next/link";
import { SEMAFORO_TONE } from "@/components/uc/common/semaforo-tone";
import { agentToneOf, titleAgent, type AgentPalette, type AgentTone } from "@/lib/use-cases/agents";
import type { CostBandInfo } from "@/lib/use-cases/cost-bands";
import { formatMonthYear, perYearText, shownPerYear, type ValueParts } from "@/lib/use-cases/format";
import type { ReferentStateKey } from "@/lib/use-cases/referent/use-case-state";
import { cardReferentState, laneBarWidth, laneValueView, type LaneKey } from "@/lib/use-cases/lanes";
import { keepTogether } from "@/lib/use-cases/line-breaks";
import { EXPIRED_TAG, isContributorItem, type AnyHubItem, type HubItem } from "@/lib/use-cases/views";
import { cn } from "@/lib/utils";
import { AGENT_BAR_CLASS, AgentTag, NEUTRAL_BAR_CLASS } from "./agent-tag";
import { CostFigure } from "./cost-figure";
import { ReferentChip } from "./referent-chip";
import { PhasePill } from "./phase-pill";
import { CodeLabel, shownPhaseLabel, subStateText, visibleCode } from "./use-case-row";
import { ValueFigure } from "./value-figure";

/** Dove sta la card nella Panoramica: una delle tre corsie, «In realizzazione» o «In uso» (`realizzati`). */
export type LaneCardPlace = LaneKey | "in_realizzazione" | "realizzati";

export interface LaneCardProps {
  item: AnyHubItem;
  place: LaneCardPlace;
  /** Apre il pannello laterale. */
  href: string;
  /** I toni degli agenti del workspace (`workspaceAgentPalette`), gli stessi per ogni ruolo. */
  agents: AgentPalette;
  /** Trimestre passato senza avvio: lo stato rosso «Scaduto», solo per i revisori. */
  expired?: boolean;
  /** La scala delle barre del valore (`laneBarScale`, sugli approvati di tutto il workspace). */
  barScale?: number;
  /** La lettura del dossier è in errore (§4.9): «In realizzazione» mostra solo la fase. */
  dossierDown?: boolean;
  bands?: readonly CostBandInfo[];
  /**
   * (Rilascio 5, §10.3) Lo stato del referente (tutti i ruoli). (Rilascio 10, D7) La card lo scrive solo quando chiede
   * un'azione (`cardReferentState`): «Manca il referente», «Nessuna risposta», «Risposte da verificare», «Il referente
   * ha chiesto qualcosa».
   */
  referentState?: ReferentStateKey | null;
}

/**
 * Una card della Panoramica (rilascio «Panoramica»; rilascio 10, D7 e prototipo S2), in sola lettura: un clic apre
 * il pannello laterale. Dall'alto:
 * - il tag dell'agente («LIBRA L1», nel suo colore), oppure il codice per un titolo senza prefisso; con il trimestre
 *   passato senza avvio lo stato rosso «Scaduto» (puntino più parola), l'unica cosa da fare che la card dice da sé;
 * - il titolo senza il prefisso, al massimo su due righe;
 * - nelle corsie la barra del valore nel colore dell'agente (grigia senza agente; piena per gli euro contati,
 *   tratteggiata per quelli da misurare), poi «58.000 € all'anno» e, a destra, «Costo 24.000 €» per «Da costruire»,
 *   senza la fonte: la dicono il pannello e la scheda (D7). Senza cifra «Valore: Alto», «Valore: da stimare»;
 * - in «In realizzazione» la fase con lo stato del dossier, o «Senza pagina di realizzazione»; con la lettura del
 *   dossier in errore solo la fase (§4.9); in «In uso» «Realizzato» o «Diffusa», il mese e gli euro all'anno;
 * - lo stato del referente solo quando chiede un'azione (D7): «Manca il referente», «Nessuna risposta», «Risposte da
 *   verificare», «Il referente ha chiesto qualcosa».
 * Il trimestre a parte, «Da diffondere» e la fonte del costo non ci sono più: li dicono il pannello (la pillola
 * «Approvato · T2 2027»), il filtro «Tipo» e la scheda. Nell'HTML il titolo viene prima della riga in alto (la
 * griglia la mette sopra): un lettore di schermo sente il titolo intero, prefisso compreso, prima di tag e cifre; il
 * tag è nascosto ai lettori di schermo, che il prefisso l'hanno già sentito.
 * I contributori vedono tag, titolo e la pillola della fase («Approvato · T1 2027»), nient'altro: niente euro,
 * barre, costo né «Scaduto» (D4, D13).
 */
export function LaneCard({ item, place, href, agents, expired = false, barScale = 0, dossierDown = false, bands, referentState = null }: LaneCardProps) {
  const agent = titleAgent(item.title);
  const reviewer = isContributorItem(item) ? null : item;
  const tone = agent ? agentToneOf(agents, agent.agent) : null;
  const chip = cardReferentState(referentState);
  return (
    <li data-slot="lane-card" data-id={item.id} data-lane={place} data-agent={agent?.agent} className="min-w-0">
      <Link
        href={href}
        scroll={false}
        className="grid h-full min-w-0 grid-cols-1 content-start gap-y-2 rounded-xl border border-input bg-card p-3 outline-none transition-colors hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <span className="row-start-2 flex min-w-0 flex-col gap-2">
          <span className="line-clamp-2 min-w-0 text-sm font-semibold break-words text-foreground">
            {agent ? (
              <>
                <span className="sr-only">{agent.prefix}</span>
                {agent.rest}
              </>
            ) : (
              item.title
            )}
          </span>
          {reviewer ? (
            <ReviewerDetails item={reviewer} place={place} tone={tone} barScale={barScale} dossierDown={dossierDown} bands={bands} />
          ) : (
            <span className="flex flex-wrap items-center gap-2">
              <PhasePill label={shownPhaseLabel(item, dossierDown)} phase={item.phase} subState={item.subState} />
            </span>
          )}
          <ReferentChip state={chip} form="puntino" className="flex" />
        </span>
        <span className="row-start-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          {agent ? <AgentTag label={agent.label} tone={tone} decorative /> : <CodeLabel code={visibleCode(item)} />}
          {reviewer && expired ? <ExpiredTag /> : null}
        </span>
      </Link>
    </li>
  );
}

/** Lo stato rosso «Scaduto» (§4.5) delle card della Panoramica: trimestre passato, senza avvio. Puntino più parola. */
export function ExpiredTag({ className }: { className?: string }) {
  return (
    <span data-slot="expired-tag" className={cn("inline-flex shrink-0 items-center gap-1.5 text-xs whitespace-nowrap", className)}>
      <span aria-hidden className={cn("size-1.5 shrink-0 rounded-full", SEMAFORO_TONE.rosso.fill)} />
      <span className="font-medium text-foreground">{EXPIRED_TAG}</span>
    </span>
  );
}

function ReviewerDetails({
  item,
  place,
  tone,
  barScale,
  dossierDown,
  bands,
}: {
  item: HubItem;
  place: LaneCardPlace;
  tone: AgentTone | null;
  barScale: number;
  dossierDown: boolean;
  bands?: readonly CostBandInfo[];
}) {
  if (place === "in_realizzazione") {
    return (
      <span className="flex flex-wrap items-center gap-2">
        <PhasePill label={shownPhaseLabel(item, dossierDown)} tone={item.tone} />
      </span>
    );
  }
  if (place === "realizzati") {
    const month = item.realizedOn ? formatMonthYear(item.realizedOn) : null;
    const perYear = perYearText(shownPerYear(item.value));
    return (
      <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
        <span className="font-medium text-foreground">
          {subStateText(item)}
          {month ? <span className="font-normal text-muted-foreground">{keepTogether(` · ${month}`)}</span> : null}
        </span>
        {perYear ? (
          <span data-figure="valore" className="text-muted-foreground tabular-nums">
            {keepTogether(perYear)}
          </span>
        ) : null}
      </span>
    );
  }
  // Nelle corsie: la barra, poi il Valore e, a destra, il costo di «Da costruire» senza la fonte (D7).
  const cost = item.kind === "da_costruire" ? <CostFigure cost={item.cost} bands={bands} form="avvio" withSource={false} className="text-right" /> : null;
  return <LaneValue value={item.value} tone={tone} barScale={barScale} cost={cost} />;
}

/**
 * Il Valore nella corsia: la barra nel colore dell'agente (grigia senza agente), piena per gli euro contati e
 * tratteggiata per quelli da misurare, nascosta ai lettori di schermo (la cifra la dice il testo); sotto il testo e, a
 * destra, il costo. Senza cifra «Valore: Alto», «Valore: da stimare».
 */
function LaneValue({ value, tone, barScale, cost }: { value: ValueParts; tone: AgentTone | null; barScale: number; cost: ReactNode }) {
  const view = laneValueView(value);
  const counted = view.bar?.kind === "contato";
  const width = view.bar ? laneBarWidth(view.bar.amount, barScale) : null;
  const bar = tone ? AGENT_BAR_CLASS[tone] : NEUTRAL_BAR_CLASS;
  return (
    <span className="flex min-w-0 flex-col gap-1.5">
      {width && view.bar ? (
        <span aria-hidden data-slot="value-bar" data-bar={view.bar.kind} className="block h-1 w-full rounded-full bg-muted">
          <span className={cn("block h-full rounded-full", counted ? bar.fill : cn("border border-dashed", bar.dashed))} style={{ width }} />
        </span>
      ) : null}
      <span className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
        {view.text === null ? (
          <ValueFigure value={value} withLabel className="text-xs" />
        ) : (
          <span data-figure="valore" className={counted ? "min-w-0 text-xs font-medium text-foreground tabular-nums" : "min-w-0 text-xs text-muted-foreground tabular-nums"}>
            {keepTogether(view.text)}
          </span>
        )}
        {cost}
      </span>
    </span>
  );
}
