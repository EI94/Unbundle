import type { ReactNode } from "react";
import type { AgentTone } from "@/lib/use-cases/agents";
import { FIGURE_SEPARATOR } from "@/lib/use-cases/format";
import { GUIDED_TEXT, limitsSummary, workClamps, workFlowLabels } from "@/lib/use-cases/guided";
import { TEXT_LIMITS } from "@/lib/use-cases/inputs";
import { WHAT_FIELD_LABEL } from "@/lib/use-cases/labels";
import type { UseCaseDetail } from "@/lib/use-cases/views";
import { cn } from "@/lib/utils";
import { Disclosure } from "../disclosure";
import { InlineTextField } from "./inline-text-field";
import { PATH_TONE_CLASS } from "./use-case-path";

export interface WorkFlowProps {
  workspaceId: string;
  detail: Pick<UseCaseDetail, "id" | "version" | "kind" | "title" | "description" | "flowDescription" | "humanInTheLoop" | "guardrails">;
  /** `canEditWhat`: tutti i revisori. */
  canEdit: boolean;
  /** Il colore dell'agente, come nel percorso; senza, il colore del testo. */
  tone?: AgentTone | null;
  className?: string;
}

/** La freccia tra due passi: in giù una sotto l'altra, a destra in riga (da 40rem della scheda). */
function Arrow() {
  return (
    <span aria-hidden className="self-center justify-self-center text-muted-foreground">
      <span className="@min-[40rem]/scheda:hidden">↓</span>
      <span className="hidden @min-[40rem]/scheda:inline">→</span>
    </span>
  );
}

/**
 * «Come cambia il lavoro» (rilascio 3): tre passi, «Oggi» (il problema), «Con LIBRA» (come funziona,
 * con il bordo nel colore del percorso) e «◆ Decide una persona» (chi controlla); per una best
 * practice «Prima», «Adesso» e «Chi la usa». Ogni passo si modifica sul posto; un testo lungo si
 * mostra corto con «Leggi tutto»; un passo vuoto è «+ Aggiungi …» per chi può scriverlo. Sotto,
 * chiusa, la piega dei limiti («Cosa LIBRA non fa mai»), solo per gli use case da costruire.
 * L'ancora resta `cosa-e`, così `?capitolo=cosa-e` e i suoi alias portano qui.
 */
export function WorkFlow({ workspaceId, detail, canEdit, tone = null, className }: WorkFlowProps) {
  const t = GUIDED_TEXT.work;
  const labels = workFlowLabels(detail.kind, detail.title);
  const item = { id: detail.id, version: detail.version };
  const label = (field: "description" | "flowDescription" | "humanInTheLoop" | "guardrails") => WHAT_FIELD_LABEL[field][detail.kind] ?? WHAT_FIELD_LABEL[field].da_costruire ?? field;
  const step = (field: "description" | "flowDescription" | "humanInTheLoop", heading: ReactNode) => (
    <InlineTextField
      workspaceId={workspaceId}
      item={item}
      field={field}
      label={label(field)}
      value={detail[field]}
      max={TEXT_LIMITS[field]}
      multiline
      canEdit={canEdit}
      heading={heading}
      clamp={workClamps(detail[field])}
    />
  );
  const limitsLabel = labels.limits;
  return (
    <section id="cosa-e" aria-labelledby="lavoro-titolo" data-slot="work-flow" className={cn("scroll-mt-20 space-y-3 [--path-c:var(--foreground)]", tone ? PATH_TONE_CLASS[tone] : null, className)}>
      <h2 id="lavoro-titolo" tabIndex={-1} className="text-base font-semibold outline-none">
        {t.title}
      </h2>
      <div data-slot="work-flow-steps" className="grid gap-2 @min-[40rem]/scheda:grid-cols-[minmax(0,1fr)_1.25rem_minmax(0,1fr)_1.25rem_minmax(0,1fr)]">
        <div data-step="oggi" className="min-w-0 rounded-xl border bg-card p-3">
          {step("description", labels.today)}
        </div>
        <Arrow />
        <div data-step="agente" className="min-w-0 rounded-xl border border-l-3 border-l-[var(--path-c)] bg-card p-3">
          {step("flowDescription", labels.agent)}
        </div>
        <Arrow />
        <div data-step="persona" className="min-w-0 rounded-xl border bg-muted/40 p-3">
          {step(
            "humanInTheLoop",
            detail.kind === "da_diffondere" ? (
              labels.human
            ) : (
              <>
                <span aria-hidden>◆ </span>
                {labels.human}
              </>
            ),
          )}
        </div>
      </div>
      {limitsLabel ? (
        <Disclosure summary={`${limitsLabel}${FIGURE_SEPARATOR}${limitsSummary(detail.guardrails)}`} slot="work-flow-limits">
          <InlineTextField
            workspaceId={workspaceId}
            item={item}
            field="guardrails"
            label={label("guardrails")}
            value={detail.guardrails}
            max={TEXT_LIMITS.guardrails}
            multiline
            canEdit={canEdit}
            compact
          />
        </Disclosure>
      ) : null}
    </section>
  );
}
