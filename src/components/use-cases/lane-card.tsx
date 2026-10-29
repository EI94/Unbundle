import Link from "next/link";
import { agentToneOf, titleAgent, type AgentPalette, type AgentTone } from "@/lib/use-cases/agents";
import type { CostBandInfo } from "@/lib/use-cases/cost-bands";
import { formatMonthYear, perYearText, shownPerYear, type ValueParts } from "@/lib/use-cases/format";
import type { InfoProgressView } from "@/lib/use-cases/info-progress";
import { laneBarWidth, laneValueView, type LaneKey } from "@/lib/use-cases/lanes";
import { EXPIRED_TAG, isContributorItem, type AnyHubItem, type HubItem } from "@/lib/use-cases/views";
import { cn } from "@/lib/utils";
import { AGENT_BAR_CLASS, AgentTag, NEUTRAL_BAR_CLASS } from "./agent-tag";
import { CostFigure } from "./cost-figure";
import { InfoChip } from "./info-chip";
import { KindLabel } from "./kind-label";
import { PhasePill } from "./phase-pill";
import { CodeLabel, shownPhaseLabel, subStateText, visibleCode } from "./use-case-row";
import { ValueFigure } from "./value-figure";

/** Dove sta la card nella Panoramica: una delle tre corsie, «In realizzazione» o «Realizzati». */
export type LaneCardPlace = LaneKey | "in_realizzazione" | "realizzati";

export interface LaneCardProps {
  item: AnyHubItem;
  place: LaneCardPlace;
  /** Apre il pannello laterale. */
  href: string;
  /** I toni degli agenti, da tutte le schede della pagina (`agentPalette`). */
  agents: AgentPalette;
  /** «T3 2026» di uno scaduto, «T2 2027» in «Più avanti» (solo revisori, `buildLanes`). */
  quarterNote?: string | null;
  /** Trimestre passato senza avvio: il tag rosso «Scaduto», solo per i revisori. */
  expired?: boolean;
  /** La scala delle barre del valore (`laneBarScale`, sugli approvati di tutto il workspace). */
  barScale?: number;
  /** La lettura del dossier è in errore (§4.9): «In realizzazione» mostra solo la fase. */
  dossierDown?: boolean;
  bands?: readonly CostBandInfo[];
  /** «Raccolta informazioni» (solo revisori): il chip corto sotto il titolo, solo «da verificare» e «senza risposta». */
  info?: InfoProgressView | null;
}

/**
 * Una card della Panoramica (rilascio «Panoramica»), in sola lettura: un clic apre il pannello
 * laterale. In alto il tag dell'agente («LIBRA L1», nel suo colore), oppure il codice per un titolo
 * senza prefisso, poi il trimestre a parte («T3 2026»), «Scaduto» e «Da diffondere»; a destra il costo
 * d'avvio con la fonte («avvio 30.000 € · team»), solo per «Da costruire» nelle corsie. Sotto il
 * titolo senza il prefisso, il chip di «Raccolta informazioni» e:
 * - nelle corsie il Valore: «12.250 € all'anno» con la barra piena, «da misurare · fino a 5.840 €»
 *   con la barra tratteggiata, «ritorno qualitativo», altrimenti «Valore: Alto», «Valore: da stimare»;
 * - in «In realizzazione» la fase con lo stato del dossier, o «Senza dossier»; con la lettura del
 *   dossier in errore solo la fase (§4.9);
 * - in «Realizzati» «Realizzato» o «Diffusa», il mese e gli euro all'anno se ci sono, senza barra.
 * Nell'HTML il titolo viene prima della riga in alto (la griglia la mette sopra): un lettore di
 * schermo sente il titolo intero, prefisso compreso, prima di tag e cifre; il tag è nascosto ai
 * lettori di schermo, che il prefisso l'hanno già sentito. Niente origine e niente codice accanto
 * al tag: li dice il pannello.
 * I contributori vedono tag, titolo e la pillola della fase («Approvato · T1 2027»), nient'altro:
 * niente euro, barre, costo, «Scaduto» né trimestre a parte (D4, D13).
 */
export function LaneCard({
  item,
  place,
  href,
  agents,
  quarterNote = null,
  expired = false,
  barScale = 0,
  dossierDown = false,
  bands,
  info = null,
}: LaneCardProps) {
  const agent = titleAgent(item.title);
  const reviewer = isContributorItem(item) ? null : item;
  const tone = agent ? agentToneOf(agents, agent.agent) : null;
  return (
    <li data-slot="lane-card" data-id={item.id} data-lane={place} data-agent={agent?.agent} className="min-w-0">
      <Link
        href={href}
        scroll={false}
        className="grid h-full min-w-0 grid-cols-[minmax(0,1fr)_auto] content-start gap-x-2 gap-y-1.5 rounded-xl border border-input bg-card px-3 py-2.5 outline-none transition-colors hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <span className="col-span-2 row-start-2 flex min-w-0 flex-col gap-1.5">
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
            <>
              <InfoChip view={info} variant="short" className="flex" />
              <ReviewerDetails item={reviewer} place={place} tone={tone} barScale={barScale} dossierDown={dossierDown} />
            </>
          ) : (
            <span className="flex flex-wrap items-center gap-2">
              <PhasePill label={shownPhaseLabel(item, dossierDown)} phase={item.phase} subState={item.subState} />
            </span>
          )}
        </span>
        <span className="col-start-1 row-start-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          {agent ? <AgentTag label={agent.label} tone={tone} decorative /> : <CodeLabel code={visibleCode(item)} />}
          {reviewer && quarterNote ? <span className="text-xs whitespace-nowrap text-muted-foreground">{quarterNote}</span> : null}
          {reviewer && expired ? <ExpiredTag /> : null}
          {reviewer?.kind === "da_diffondere" ? <KindLabel kind="da_diffondere" /> : null}
        </span>
        {reviewer && reviewer.kind === "da_costruire" && place !== "in_realizzazione" && place !== "realizzati" ? (
          <CostFigure cost={reviewer.cost} bands={bands} form="avvio" className="col-start-2 row-start-1 self-start text-right" />
        ) : null}
      </Link>
    </li>
  );
}

/** Il tag rosso «Scaduto» (§4.5) delle card della Panoramica: trimestre passato, senza avvio. */
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
  place,
  tone,
  barScale,
  dossierDown,
}: {
  item: HubItem;
  place: LaneCardPlace;
  tone: AgentTone | null;
  barScale: number;
  dossierDown: boolean;
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
          {month ? <span className="font-normal text-muted-foreground"> · {month}</span> : null}
        </span>
        {perYear ? (
          <span data-figure="valore" className="text-muted-foreground tabular-nums">
            {perYear}
          </span>
        ) : null}
      </span>
    );
  }
  return <LaneValue value={item.value} tone={tone} barScale={barScale} />;
}

/**
 * Il Valore nella corsia: il testo e, con una cifra, la barra nel colore dell'agente (grigia senza
 * agente), piena per gli euro contati e tratteggiata per quelli da misurare. La barra è nascosta ai
 * lettori di schermo: la cifra la dice il testo. Senza cifra «Valore: Alto», «Valore: da stimare».
 */
function LaneValue({ value, tone, barScale }: { value: ValueParts; tone: AgentTone | null; barScale: number }) {
  const view = laneValueView(value);
  if (view.text === null) return <ValueFigure value={value} withLabel className="text-xs" />;
  const counted = view.bar?.kind === "contato";
  const width = view.bar ? laneBarWidth(view.bar.amount, barScale) : null;
  const bar = tone ? AGENT_BAR_CLASS[tone] : NEUTRAL_BAR_CLASS;
  return (
    <span data-figure="valore" className="flex min-w-0 flex-col gap-1">
      <span className={counted ? "text-xs font-medium text-foreground tabular-nums" : "text-xs text-muted-foreground tabular-nums"}>{view.text}</span>
      {width && view.bar ? (
        <span aria-hidden data-slot="value-bar" data-bar={view.bar.kind} className="block h-1.5 w-full rounded-full bg-muted">
          <span className={cn("block h-full rounded-full", counted ? bar.fill : cn("border border-dashed", bar.dashed))} style={{ width }} />
        </span>
      ) : null}
    </span>
  );
}
