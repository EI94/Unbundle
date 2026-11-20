import Link from "next/link";
import { PATH_TONE_CLASS } from "@/components/use-cases/detail/use-case-path";
import { SOLUTION_TEXT as T, type BoardStep } from "@/lib/uc/views/solution";
import type { Audience } from "@/lib/uc/views/status-groups";
import type { AgentTone } from "@/lib/use-cases/agents";
import { cn } from "@/lib/utils";
import { ToneDot, stepToneText } from "./map-parts";

/**
 * (Rilascio 10, docs/ui-10/PROPOSTA-10.md §3.5) «Come funziona» disegnato come la board, in sola lettura: un passo è
 * una card della stessa larghezza delle altre, con una freccia tra due card; il titolo, «Chi», «◆ Decide una persona»
 * e lo stato delle domande come puntino (con la parola per i lettori di schermo). I passi che fa l'agente hanno il bordo
 * sinistro nel colore dell'agente (`--path-c`, come nel percorso e in «Come cambia il lavoro» della scheda dello use
 * case); senza un colore, quello del testo. Una card apre il pannello del passo (`?apri=passo-<id>`), con le domande e
 * il resto: niente si modifica qui.
 *
 * Da 640 px una riga, che scorre dentro la sua cornice (mai la pagina); al telefono un elenco verticale di card, con
 * la freccia in giù (§5.7). Senza stato: si rende sul server.
 */
export function ProcessBoard({
  steps,
  hrefFor,
  agentTone,
  audience,
  label,
}: {
  steps: readonly BoardStep[];
  hrefFor: (stepId: string) => string;
  /** Il colore dell'agente dello use case (`workspaceAgentToneOf`); null: quello del testo. */
  agentTone: AgentTone | null;
  audience: Audience;
  /** Il nome dell'elenco per i lettori di schermo. */
  label: string;
}) {
  if (steps.length === 0) return null;
  return (
    <div data-slot="process-board" className={cn("-mx-1 min-w-0 overflow-x-auto px-1 pb-2 [--path-c:var(--foreground)] [scrollbar-width:thin]", agentTone ? PATH_TONE_CLASS[agentTone] : null)}>
      <ol aria-label={label} className="flex min-w-0 flex-col gap-1 sm:w-max sm:flex-row sm:items-stretch">
        {steps.map((s, i) => (
          <li key={s.id} className="flex min-w-0 flex-col items-stretch gap-1 sm:flex-row sm:items-center">
            {i > 0 ? (
              <span aria-hidden className="self-center text-muted-foreground">
                <span className="sm:hidden">↓</span>
                <span className="hidden sm:inline">→</span>
              </span>
            ) : null}
            <Link
              href={hrefFor(s.id)}
              scroll={false}
              data-step={s.n}
              data-agent={s.agent ? "" : undefined}
              className={cn(
                "flex min-h-11 w-full min-w-0 flex-col gap-1.5 rounded-xl border bg-card p-3 text-left transition-colors hover:bg-muted/40 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none sm:h-full sm:w-48",
                s.agent && "border-l-3 border-l-[var(--path-c)]",
                s.decision && "bg-muted/40",
              )}
            >
              <span className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                <span className="tabular-nums">
                  <span className="sr-only">{T.step(s.n)}: </span>
                  <span aria-hidden>{s.n}</span>
                </span>
                <ToneDot tone={s.tone} />
              </span>
              <span className="line-clamp-3 text-sm font-medium break-words">{s.title}</span>
              {s.who ? (
                <span className="line-clamp-2 text-xs break-words text-muted-foreground">
                  {T.who} {s.who}
                </span>
              ) : null}
              {s.decision ? (
                <span className="text-xs font-medium">
                  <span aria-hidden>◆ </span>
                  {T.decides}
                </span>
              ) : null}
              <span className="sr-only">
                {s.agent ? `, ${T.agentStep}` : ""}, {stepToneText(s.tone, audience)}
              </span>
            </Link>
          </li>
        ))}
      </ol>
    </div>
  );
}
