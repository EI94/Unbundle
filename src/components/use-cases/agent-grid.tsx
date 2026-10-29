import { agentToneOf, type AgentPalette } from "@/lib/use-cases/agents";
import { formatInteger, perYearText } from "@/lib/use-cases/format";
import { agentCardId, type AgentGroup } from "@/lib/use-cases/lanes";
import { keepTogether } from "@/lib/use-cases/line-breaks";
import { totalsNote } from "@/lib/use-cases/views";
import { cn } from "@/lib/utils";
import { AGENT_BAR_CLASS, AGENT_TEXT_CLASS, NEUTRAL_BAR_CLASS, NEUTRAL_TEXT_CLASS } from "./agent-tag";
import { HashFocusLink } from "./list-focus";

/** Testi dei gruppi «Per agente». */
export const AGENT_GRID_TEXT = Object.freeze({
  noCounted: "Nessuna cifra contata",
});

export interface AgentGridProps {
  /** I gruppi delle corsie (`agentGroups`), nel loro ordine. */
  groups: readonly AgentGroup[];
  /** Le corsie del solo agente (`?agente=`), con l'ancora delle corsie. */
  hrefOf: (param: string) => string;
  /** I toni degli agenti del workspace (`workspaceAgentPalette`), gli stessi per ogni ruolo. */
  agents: AgentPalette;
}

/**
 * «Per agente» (rilascio «Panoramica»): una card per agente del titolo, «Altri use case» in fondo.
 * In ogni card il nome nel colore dell'agente, quanti use case, gli euro contati all'anno («12.300 €
 * all'anno · su 3 use case» quando non tutti ne hanno, altrimenti «Nessuna cifra contata»), una barra
 * sulla scala del gruppo più grande e i trimestri («T4 · 3», «Più avanti · 1»). Un clic porta alle
 * corsie del solo agente (`?agente=LIBRA#panoramica-approvati`): Next scorre all'ancora e
 * `HashFocusLink` le dà il fuoco, così un lettore di schermo sente «Use case di LIBRA per trimestre».
 * Ogni card ha la sua ancora (`agentCardId`, `agente-LIBRA`): «‹ Tutti gli agenti» riporta il fuoco
 * sulla card aperta.
 * Nessun conto per persona: l'agente è il prefisso del titolo.
 */
export function AgentGrid({ groups, hrefOf, agents }: AgentGridProps) {
  const maxEur = groups.reduce((max, group) => Math.max(max, group.perYearEur), 0);
  return (
    <ul data-slot="agent-grid" className="grid gap-3 @2xl/hub:grid-cols-2 @5xl/hub:grid-cols-3">
      {groups.map((group) => (
        <AgentCard key={group.param} group={group} href={hrefOf(group.param)} agents={agents} maxEur={maxEur} />
      ))}
    </ul>
  );
}

function AgentCard({ group, href, agents, maxEur }: { group: AgentGroup; href: string; agents: AgentPalette; maxEur: number }) {
  const tone = agentToneOf(agents, group.agent);
  const bar = tone ? AGENT_BAR_CLASS[tone] : NEUTRAL_BAR_CLASS;
  return (
    <li data-slot="agent-card" data-agent={group.param} className="min-w-0">
      {/* Senza `scroll={false}`: l'ancora porta alle corsie dell'agente e prende il fuoco. L'`id` è l'ancora del ritorno. */}
      <HashFocusLink
        id={agentCardId(group.param)}
        href={href}
        className="flex h-full scroll-mt-24 flex-col gap-2 rounded-xl border border-input bg-card px-3 py-2.5 outline-none transition-colors hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <span className="flex min-w-0 items-baseline justify-between gap-2">
          <span
            className={cn(
              "min-w-0 truncate text-sm font-semibold",
              group.agent ? cn("font-mono tracking-wide uppercase", tone ? AGENT_TEXT_CLASS[tone] : NEUTRAL_TEXT_CLASS) : "text-foreground",
            )}
          >
            {group.label}
          </span>
          <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{`${formatInteger(group.count)} use case`}</span>
        </span>
        {group.counted > 0 ? (
          <span className="text-xs text-muted-foreground">
            <span data-figure="valore" className="text-sm font-medium text-foreground tabular-nums">
              {keepTogether(perYearText({ amount: group.perYearEur }))}
            </span>
            {group.counted < group.count ? keepTogether(` · ${totalsNote(group.counted)}`) : null}
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">{AGENT_GRID_TEXT.noCounted}</span>
        )}
        {group.perYearEur > 0 && maxEur > 0 ? (
          <span aria-hidden data-slot="agent-bar" className="block h-1.5 rounded-full bg-muted">
            <span className={cn("block h-full rounded-full", bar.fill)} style={{ width: `${Math.max(4, Math.round((100 * group.perYearEur) / maxEur))}%` }} />
          </span>
        ) : null}
        <span className="mt-auto flex flex-wrap gap-1.5">
          {group.lanes.map((lane) => (
            <span key={lane.key} className="rounded-full bg-muted px-2 py-0.5 text-xs text-foreground tabular-nums">
              <span aria-hidden>{`${lane.short} · ${formatInteger(lane.count)}`}</span>
              <span className="sr-only">{`${lane.label}: ${formatInteger(lane.count)} use case`}</span>
            </span>
          ))}
        </span>
      </HashFocusLink>
    </li>
  );
}
