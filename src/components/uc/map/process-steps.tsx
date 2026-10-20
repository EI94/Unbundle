import { readableFlowData, readableOtherData, stepTechKeys, stepTone, type ProcessStepView, type SolutionNodeView } from "@/lib/uc/views/map";
import type { Audience } from "@/lib/uc/views/status-groups";
import type { CaseRole } from "@/lib/uc/vocab";
import { StepItems, StepKeysDetails, StepNumber } from "./map-parts";

/**
 * L'elenco dei passi della Mappa (DESIGN §3.7.2):
 *
 *   1  Arriva la richiesta                      Commerciale · Posta · 5 min
 *      Attrito: i dati arrivano sparsi in tre posti.
 *      ● Tipo di richiesta   ● Cliente   ○ Data di partenza
 *      Decide la persona: sceglie l'opzione da proporre.
 *
 * Il numero ha il colore del passo (la domanda messa peggio); ogni domanda ha
 * il suo puntino e il titolo, mai la chiave. I testi arrivano già puliti da
 * `buildMaps` (niente codici dei fatti; per il cliente niente articoli né
 * chiavi). Prosa e link: nessuna cornice.
 */

function Meta({ parts }: { parts: (string | null)[] }) {
  const text = parts.filter(Boolean).join(" · ");
  return text ? <p className="text-xs break-words text-muted-foreground sm:text-right">{text}</p> : null;
}

function StepRow({ n, label, meta, audience, children, tone }: { n: number; label: string; meta: (string | null)[]; audience: Audience; tone: ReturnType<typeof stepTone>; children: React.ReactNode }) {
  return (
    <li className="grid min-w-0 grid-cols-[2rem_minmax(0,1fr)] gap-x-3 py-4 first:pt-0">
      <StepNumber n={n} tone={tone} audience={audience} />
      <div className="min-w-0 space-y-2">
        <div className="flex min-w-0 flex-col gap-x-4 gap-y-0.5 sm:flex-row sm:items-baseline sm:justify-between">
          <p className="min-w-0 font-medium break-words">{label}</p>
          <Meta parts={meta} />
        </div>
        {children}
      </div>
    </li>
  );
}

const NO_TITLES: ReadonlyMap<string, string> = new Map();

/** Un processo a passi: con l'agente, di oggi, oppure l'esempio dall'inizio alla fine. */
export function ProcessSteps({
  workspaceId,
  caseId,
  steps,
  audience,
  roles,
}: {
  workspaceId: string;
  caseId: string;
  steps: readonly ProcessStepView[];
  audience: Audience;
  /** Per i «Dettagli tecnici» con le chiavi citate dai passi (solo Lateral Space). */
  roles: readonly CaseRole[];
}) {
  if (steps.length === 0) return null;
  return (
    <div className="min-w-0 space-y-4">
      <ol className="divide-y divide-border">
        {steps.map((s, i) => (
          <StepRow key={s.id} n={i + 1} label={s.label} meta={[s.who, s.tool, s.time]} audience={audience} tone={stepTone(s.items)}>
            {s.friction && <p className="rounded-lg bg-uc-rosso-bg px-3 py-2 text-sm break-words">Attrito: {s.friction}</p>}
            <StepItems workspaceId={workspaceId} caseId={caseId} items={s.items} otherData={readableOtherData(s.otherData, audience)} audience={audience} />
            {s.humanDecision && (
              <p className="text-sm break-words text-muted-foreground">
                <span className="font-medium text-foreground">Decide la persona:</span> {s.humanDecision}
              </p>
            )}
          </StepRow>
        ))}
      </ol>
      <StepKeysDetails roles={roles} steps={steps.map((s, i) => ({ n: i + 1, label: s.label, keys: stepTechKeys(s.items, s.otherData, NO_TITLES) }))} />
    </div>
  );
}

/** I passi della mappa della soluzione come elenco, nell'ordine del flusso (`flowOrder`). */
export function SolutionSteps({
  workspaceId,
  caseId,
  nodes,
  titles,
  audience,
  roles,
}: {
  workspaceId: string;
  caseId: string;
  nodes: readonly SolutionNodeView[];
  /** Titoli delle domande per chiave (`mapItemTitles`): ciò che entra ed esce si legge con i titoli. */
  titles: ReadonlyMap<string, string>;
  audience: Audience;
  /** Per i «Dettagli tecnici» con le chiavi citate dai passi (solo Lateral Space). */
  roles: readonly CaseRole[];
}) {
  if (nodes.length === 0) return null;
  return (
    <div className="min-w-0 space-y-4">
      <ol className="divide-y divide-border">
        {nodes.map((n, i) => {
          const input = readableFlowData(n.input, titles, audience);
          const output = readableFlowData(n.output, titles, audience);
          return (
            <StepRow key={n.id} n={i + 1} label={n.label} meta={[n.who]} audience={audience} tone={stepTone(n.items)}>
              {n.description && <p className="text-sm break-words whitespace-pre-line text-muted-foreground">{n.description}</p>}
              {(input.length > 0 || output.length > 0) && (
                <p className="text-xs break-words text-muted-foreground">
                  {[input.length > 0 ? `Entra: ${input.join(", ")}` : null, output.length > 0 ? `Esce: ${output.join(", ")}` : null].filter(Boolean).join(" · ")}
                </p>
              )}
              <StepItems workspaceId={workspaceId} caseId={caseId} items={n.items} audience={audience} />
            </StepRow>
          );
        })}
      </ol>
      <StepKeysDetails roles={roles} steps={nodes.map((n, i) => ({ n: i + 1, label: n.label, keys: stepTechKeys(n.items, [...n.input, ...n.output], titles) }))} />
    </div>
  );
}
